import crypto from "node:crypto";
import type { Channel, MessageRecord, QuickChatRequest, QuickChatResult } from "../../shared/schemas";
import type { SqliteDatabase } from "../db/sqlite";
import type { JsonlLogger } from "../logging/logger";
import { redactError } from "../logging/redaction";
import { OpenAiCompatibleAdapter, ProviderConfigurationError } from "../runtime/openAiCompatibleAdapter";
import type { SettingsStore } from "../settings/settingsStore";

type MessageRow = Omit<MessageRecord, "metadata"> & { metadataJson: string };

type AgentRow = {
  id: string;
  name: string;
  instructions: string;
  enabled: number;
  providerType: string;
  model: string | null;
};

const HISTORY_MESSAGE_LIMIT = 24;
const HISTORY_CHAR_BUDGET = 12000;

export class QuickChatStore {
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(
    private readonly db: SqliteDatabase,
    private readonly logger: JsonlLogger,
    private readonly settingsStore: SettingsStore,
    private readonly adapter: OpenAiCompatibleAdapter
  ) {}

  listMessages(channelId: string, limit = 100): MessageRecord[] {
    this.getChannelRequired(channelId);
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM (
          SELECT
            id,
            channel_id AS channelId,
            task_id AS taskId,
            session_id AS sessionId,
            author_type AS authorType,
            author_id AS authorId,
            content,
            metadata_json AS metadataJson,
            created_at AS createdAt
          FROM messages
          WHERE channel_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        )
        ORDER BY createdAt ASC, id ASC
      `
      )
      .all(channelId, limit) as MessageRow[];
    return rows.map(mapMessageRow);
  }

  cancel(requestId: string): { cancelled: boolean; requestId: string } {
    const controller = this.activeRequests.get(requestId);
    if (!controller) {
      return { cancelled: false, requestId };
    }
    controller.abort();
    this.activeRequests.delete(requestId);
    return { cancelled: true, requestId };
  }

  async send(
    input: QuickChatRequest,
    correlationId: string,
    onDelta?: (payload: { requestId: string; messageId: string; delta: string; done: boolean }) => void
  ): Promise<QuickChatResult> {
    this.adapter.assertConfigured();
    const settings = this.settingsStore.get();
    const channel = this.getChannelRequired(input.channelId ?? settings.quickChatChannelId);
    const agent = this.resolveAgent(input.agentId);
    const requestId = input.clientRequestId ?? correlationId;
    const assistantMessageId = `message-${crypto.randomUUID()}`;
    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);

    const userMessage = this.insertMessage({
      channelId: channel.id,
      authorType: "user",
      authorId: null,
      content: input.message.trim(),
      metadata: { source: "quick-chat", projectId: input.projectId ?? null }
    });

    try {
      const result = await this.adapter.complete({
        messages: this.buildPromptMessages(channel.id, agent, userMessage.content),
        signal: controller.signal,
        onDelta: (delta) => onDelta?.({ requestId, messageId: assistantMessageId, delta, done: false })
      });
      const assistantMessage = this.insertMessage({
        id: assistantMessageId,
        channelId: channel.id,
        authorType: "assistant",
        authorId: agent.id,
        content: result.content || "(empty response)",
        metadata: {
          source: "quick-chat",
          provider: result.provider,
          model: result.model,
          streamed: result.streamed,
          agentName: agent.name
        }
      });
      onDelta?.({ requestId, messageId: assistantMessage.id, delta: "", done: true });
      this.logger.info({
        source: "chat",
        eventName: "quick-chat.complete",
        message: "Quick chat completed",
        correlationId,
        metadata: { channelId: channel.id, agentId: agent.id, model: result.model, streamed: result.streamed }
      });
      return {
        channel,
        userMessage,
        assistantMessage,
        provider: result.provider,
        model: result.model,
        streamed: result.streamed,
        errorMessage: null
      };
    } catch (error) {
      const safeMessage = safeProviderErrorMessage(error);
      const errorRecord = this.insertMessage({
        id: assistantMessageId,
        channelId: channel.id,
        authorType: "system",
        authorId: null,
        content: safeMessage,
        metadata: {
          source: "quick-chat",
          provider: settings.corporateProviderName,
          model: settings.openAiCompatibleModel,
          error: redactError(error)
        }
      });
      onDelta?.({ requestId, messageId: errorRecord.id, delta: "", done: true });
      this.logger.exception({
        source: "chat",
        eventName: "quick-chat.provider.failure",
        message: "Quick chat provider failure was persisted",
        correlationId,
        error,
        metadata: { channelId: channel.id, agentId: agent.id }
      });
      return {
        channel,
        userMessage,
        assistantMessage: errorRecord,
        provider: settings.corporateProviderName,
        model: settings.openAiCompatibleModel,
        streamed: false,
        errorMessage: safeMessage
      };
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  private buildPromptMessages(channelId: string, agent: AgentRow, latestMessage: string) {
    return [
      {
        role: "system" as const,
        content: `${agent.instructions}\n\nYou are answering a quick non-coding chat inside Lelio. Be concise and helpful.`
      },
      ...this.recentHistory(channelId),
      { role: "user" as const, content: latestMessage }
    ];
  }

  private recentHistory(channelId: string) {
    const rows = this.listMessages(channelId, HISTORY_MESSAGE_LIMIT).filter((message) =>
      ["user", "assistant"].includes(message.authorType)
    );
    const selected: Array<{ role: "user" | "assistant"; content: string }> = [];
    let total = 0;
    for (const message of rows.reverse()) {
      const content = message.content.slice(0, HISTORY_CHAR_BUDGET);
      if (total + content.length > HISTORY_CHAR_BUDGET) {
        break;
      }
      total += content.length;
      selected.push({
        role: message.authorType === "assistant" ? "assistant" : "user",
        content
      });
    }
    return selected.reverse();
  }

  private resolveAgent(agentId?: string): AgentRow {
    const row = agentId
      ? this.getAgent(agentId)
      : this.getAgent("agent-researcher") ?? this.firstEnabledOpenAiAgent();
    if (!row) {
      throw new Error("No enabled OpenAI-compatible quick chat agent is available");
    }
    if (!row.enabled || row.providerType !== "openai-compatible") {
      throw new Error(`Agent is not available for quick chat: ${row.name}`);
    }
    return row;
  }

  private getAgent(agentId: string): AgentRow | null {
    return (
      (this.db
        .prepare(
          `
          SELECT
            id, name, instructions, enabled, provider_type AS providerType, model
          FROM agent_profiles
          WHERE id = ?
        `
        )
        .get(agentId) as AgentRow | undefined) ?? null
    );
  }

  private firstEnabledOpenAiAgent(): AgentRow | null {
    return (
      (this.db
        .prepare(
          `
          SELECT
            id, name, instructions, enabled, provider_type AS providerType, model
          FROM agent_profiles
          WHERE enabled = 1 AND provider_type = 'openai-compatible'
          ORDER BY name ASC
          LIMIT 1
        `
        )
        .get() as AgentRow | undefined) ?? null
    );
  }

  private getChannelRequired(channelId: string): Channel {
    const row = this.db
      .prepare(
        `
        SELECT id, type, name, project_id AS projectId, created_at AS createdAt, updated_at AS updatedAt
        FROM channels
        WHERE id = ?
      `
      )
      .get(channelId) as Channel | undefined;
    if (!row) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    return row;
  }

  private insertMessage(input: {
    id?: string;
    channelId: string;
    authorType: string;
    authorId: string | null;
    content: string;
    metadata: Record<string, unknown>;
  }): MessageRecord {
    const message: MessageRecord = {
      id: input.id ?? `message-${crypto.randomUUID()}`,
      channelId: input.channelId,
      taskId: null,
      sessionId: null,
      authorType: input.authorType,
      authorId: input.authorId,
      content: input.content,
      metadata: input.metadata,
      createdAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `
        INSERT INTO messages (
          id, channel_id, task_id, session_id, author_type, author_id, content, metadata_json, created_at
        ) VALUES (
          @id, @channelId, @taskId, @sessionId, @authorType, @authorId, @content, @metadataJson, @createdAt
        )
      `
      )
      .run({
        id: message.id,
        channelId: message.channelId,
        taskId: message.taskId,
        sessionId: message.sessionId,
        authorType: message.authorType,
        authorId: message.authorId,
        content: message.content,
        metadataJson: JSON.stringify(message.metadata),
        createdAt: message.createdAt
      });
    return message;
  }
}

function mapMessageRow(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    channelId: row.channelId,
    taskId: row.taskId,
    sessionId: row.sessionId,
    authorType: row.authorType,
    authorId: row.authorId,
    content: row.content,
    metadata: parseJsonObject(row.metadataJson),
    createdAt: row.createdAt
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeProviderErrorMessage(error: unknown): string {
  if (error instanceof ProviderConfigurationError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Provider request failed";
}
