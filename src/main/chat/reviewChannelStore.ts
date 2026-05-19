import crypto from "node:crypto";
import type {
  Channel,
  ChecklistItem,
  MessageRecord,
  ReviewAgentReply,
  ReviewRoundRequest,
  ReviewRoundResult,
  ReviewSynthesisRequest,
  ReviewSynthesisResult,
  TaskCommentRecord
} from "../../shared/schemas";
import type { SqliteDatabase } from "../db/sqlite";
import type { JsonlLogger } from "../logging/logger";
import { redactError, redactString } from "../logging/redaction";
import type { OpenAiCompatibleAdapter } from "../runtime/openAiCompatibleAdapter";
import type { SettingsStore } from "../settings/settingsStore";

type MessageRow = Omit<MessageRecord, "metadata"> & { metadataJson: string };

type TaskCommentRow = Omit<TaskCommentRecord, "metadata" | "checklist"> & {
  checklistJson: string;
  metadataJson: string;
};

type AgentRow = {
  id: string;
  name: string;
  slug: string;
  role: string;
  instructions: string;
  enabled: number;
  providerType: string;
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  projectName: string | null;
};

const REVIEW_HISTORY_LIMIT = 40;
const REVIEW_HISTORY_CHAR_BUDGET = 14000;
const PLANNER_AGENT_ID = "agent-planner";

export class ReviewChannelStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly logger: JsonlLogger,
    private readonly settingsStore: SettingsStore,
    private readonly adapter: OpenAiCompatibleAdapter
  ) {}

  listTaskComments(taskId: string): TaskCommentRecord[] {
    this.getTaskRequired(taskId);
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          task_id AS taskId,
          channel_id AS channelId,
          message_id AS messageId,
          author_type AS authorType,
          author_id AS authorId,
          content,
          checklist_json AS checklistJson,
          metadata_json AS metadataJson,
          created_at AS createdAt
        FROM task_comments
        WHERE task_id = ?
        ORDER BY created_at DESC, id DESC
      `
      )
      .all(taskId) as TaskCommentRow[];
    return rows.map(mapTaskCommentRow);
  }

  async runReviewRound(input: ReviewRoundRequest, correlationId: string): Promise<ReviewRoundResult> {
    this.adapter.assertConfigured();
    const channel = this.getChannelRequired(input.channelId);
    const agents = this.resolveReviewAgents(input.agentIds);
    const task = input.taskId ? this.getTaskRequired(input.taskId) : null;
    const reviewRoundId = input.clientRequestId ?? `review-round-${crypto.randomUUID()}`;
    const mentions = agents.map((agent) => `@${agent.slug}`);
    const requestMessage = this.insertMessage({
      channelId: channel.id,
      taskId: task?.id ?? null,
      authorType: "user",
      authorId: null,
      content: `${mentions.join(" ")}\n${input.prompt.trim()}`,
      metadata: {
        source: "review-round",
        reviewRoundId,
        mentions,
        agentIds: agents.map((agent) => agent.id),
        projectId: input.projectId ?? null
      }
    });

    const limit = Math.max(1, this.settingsStore.get().maxConcurrentReviewSessions);
    const replies = await runLimited(agents, limit, (agent) =>
      this.requestAgentReview({
        agent,
        channel,
        task,
        prompt: input.prompt.trim(),
        reviewRoundId,
        correlationId
      })
    );
    const errorCount = replies.filter((reply) => reply.errorMessage).length;
    this.logger.info({
      source: "review",
      eventName: "review.round.complete",
      message: "Review round completed",
      correlationId,
      metadata: { reviewRoundId, channelId: channel.id, taskId: task?.id ?? null, agentCount: agents.length, errorCount }
    });
    return { channel, requestMessage, replies, errorCount, reviewRoundId };
  }

  async synthesize(input: ReviewSynthesisRequest, correlationId: string): Promise<ReviewSynthesisResult> {
    this.adapter.assertConfigured();
    const channel = this.getChannelRequired(input.channelId);
    const task = this.getTaskRequired(input.taskId);
    const synthesizer = this.getAgentRequired(PLANNER_AGENT_ID);
    const sourceMessages = this.reviewMessagesForSynthesis(channel.id, task.id);
    const prompt = buildSynthesisPrompt(task, sourceMessages, input.instructions ?? null);

    try {
      const response = await this.adapter.complete({
        messages: [
          {
            role: "system",
            content: `${synthesizer.instructions}\n\nSynthesize multi-agent review output into a concise task comment and checklist.`
          },
          { role: "user", content: prompt }
        ]
      });
      const synthesisMessage = this.insertMessage({
        channelId: channel.id,
        taskId: task.id,
        authorType: "assistant",
        authorId: synthesizer.id,
        content: response.content,
        metadata: {
          source: "review-synthesis",
          taskId: task.id,
          provider: response.provider,
          model: response.model,
          agentName: synthesizer.name
        }
      });
      const taskComment = this.insertTaskComment({
        taskId: task.id,
        channelId: channel.id,
        messageId: synthesisMessage.id,
        authorType: "assistant",
        authorId: synthesizer.id,
        content: response.content,
        checklist: parseChecklist(response.content),
        metadata: {
          source: "review-synthesis",
          channelId: channel.id,
          sourceMessageCount: sourceMessages.length
        }
      });
      this.logger.info({
        source: "review",
        eventName: "review.synthesis.complete",
        message: "Review synthesis completed",
        correlationId,
        metadata: { channelId: channel.id, taskId: task.id, messageId: synthesisMessage.id, taskCommentId: taskComment.id }
      });
      return { channel, synthesisMessage, taskComment, errorMessage: null };
    } catch (error) {
      const safeMessage = safeProviderErrorMessage(error);
      const synthesisMessage = this.insertMessage({
        channelId: channel.id,
        taskId: task.id,
        authorType: "system",
        authorId: synthesizer.id,
        content: safeMessage,
        metadata: {
          source: "review-synthesis",
          taskId: task.id,
          error: redactError(error)
        }
      });
      this.logger.exception({
        source: "review",
        eventName: "review.synthesis.failure",
        message: "Review synthesis provider failure was persisted",
        correlationId,
        error,
        metadata: { channelId: channel.id, taskId: task.id }
      });
      return { channel, synthesisMessage, taskComment: null, errorMessage: safeMessage };
    }
  }

  private async requestAgentReview(input: {
    agent: AgentRow;
    channel: Channel;
    task: TaskRow | null;
    prompt: string;
    reviewRoundId: string;
    correlationId: string;
  }): Promise<ReviewAgentReply> {
    try {
      const response = await this.adapter.complete({
        messages: [
          {
            role: "system",
            content: `${input.agent.instructions}\n\nYou are participating in a parallel group review. Give independent, high-signal feedback.`
          },
          {
            role: "user",
            content: buildAgentReviewPrompt(input.prompt, input.task)
          }
        ]
      });
      const message = this.insertMessage({
        channelId: input.channel.id,
        taskId: input.task?.id ?? null,
        authorType: "assistant",
        authorId: input.agent.id,
        content: response.content,
        metadata: {
          source: "review-round",
          reviewRoundId: input.reviewRoundId,
          agentName: input.agent.name,
          agentSlug: input.agent.slug,
          provider: response.provider,
          model: response.model
        }
      });
      this.logger.info({
        source: "review",
        eventName: "review.agent.complete",
        message: "Review agent replied",
        correlationId: input.correlationId,
        metadata: { reviewRoundId: input.reviewRoundId, agentId: input.agent.id, messageId: message.id }
      });
      return { agentId: input.agent.id, agentName: input.agent.name, message, errorMessage: null };
    } catch (error) {
      const safeMessage = safeProviderErrorMessage(error);
      const message = this.insertMessage({
        channelId: input.channel.id,
        taskId: input.task?.id ?? null,
        authorType: "system",
        authorId: input.agent.id,
        content: safeMessage,
        metadata: {
          source: "review-round",
          reviewRoundId: input.reviewRoundId,
          agentName: input.agent.name,
          agentSlug: input.agent.slug,
          error: redactError(error)
        }
      });
      this.logger.exception({
        source: "review",
        eventName: "review.agent.failure",
        message: "Review agent provider failure was persisted",
        correlationId: input.correlationId,
        error,
        metadata: { reviewRoundId: input.reviewRoundId, agentId: input.agent.id, messageId: message.id }
      });
      return { agentId: input.agent.id, agentName: input.agent.name, message, errorMessage: safeMessage };
    }
  }

  private resolveReviewAgents(agentIds: string[]): AgentRow[] {
    const uniqueIds = Array.from(new Set(agentIds));
    if (uniqueIds.length < 3) {
      throw new Error("Review rounds require at least three unique agents");
    }
    const agents = uniqueIds.map((agentId) => this.getAgentRequired(agentId));
    const invalid = agents.find((agent) => !agent.enabled || agent.providerType !== "openai-compatible");
    if (invalid) {
      throw new Error(`Agent is not available for group review: ${invalid.name}`);
    }
    return agents;
  }

  private getAgentRequired(agentId: string): AgentRow {
    const row = this.db
      .prepare(
        `
        SELECT
          id, name, slug, role, instructions, enabled, provider_type AS providerType
        FROM agent_profiles
        WHERE id = ?
      `
      )
      .get(agentId) as AgentRow | undefined;
    if (!row) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    return row;
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

  private getTaskRequired(taskId: string): TaskRow {
    const row = this.db
      .prepare(
        `
        SELECT
          t.id, t.title, t.description, t.status, t.priority, p.name AS projectName
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.id = ?
      `
      )
      .get(taskId) as TaskRow | undefined;
    if (!row) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return row;
  }

  private reviewMessagesForSynthesis(channelId: string, taskId: string): MessageRecord[] {
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
          WHERE channel_id = ? AND task_id = ? AND json_extract(metadata_json, '$.source') = 'review-round'
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        )
        ORDER BY createdAt ASC, id ASC
      `
      )
      .all(channelId, taskId, REVIEW_HISTORY_LIMIT) as MessageRow[];
    const messages = rows.map(mapMessageRow);
    let total = 0;
    const selected: MessageRecord[] = [];
    for (const message of messages.reverse()) {
      if (total + message.content.length > REVIEW_HISTORY_CHAR_BUDGET) {
        break;
      }
      total += message.content.length;
      selected.push(message);
    }
    return selected.reverse();
  }

  private insertMessage(input: {
    channelId: string;
    taskId: string | null;
    authorType: string;
    authorId: string | null;
    content: string;
    metadata: Record<string, unknown>;
  }): MessageRecord {
    const message: MessageRecord = {
      id: `message-${crypto.randomUUID()}`,
      channelId: input.channelId,
      taskId: input.taskId,
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

  private insertTaskComment(input: {
    taskId: string;
    channelId: string;
    messageId: string;
    authorType: string;
    authorId: string;
    content: string;
    checklist: ChecklistItem[];
    metadata: Record<string, unknown>;
  }): TaskCommentRecord {
    const comment: TaskCommentRecord = {
      id: `task-comment-${crypto.randomUUID()}`,
      taskId: input.taskId,
      channelId: input.channelId,
      messageId: input.messageId,
      authorType: input.authorType,
      authorId: input.authorId,
      content: input.content,
      checklist: input.checklist,
      metadata: input.metadata,
      createdAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `
        INSERT INTO task_comments (
          id, task_id, channel_id, message_id, author_type, author_id,
          content, checklist_json, metadata_json, created_at
        ) VALUES (
          @id, @taskId, @channelId, @messageId, @authorType, @authorId,
          @content, @checklistJson, @metadataJson, @createdAt
        )
      `
      )
      .run({
        id: comment.id,
        taskId: comment.taskId,
        channelId: comment.channelId,
        messageId: comment.messageId,
        authorType: comment.authorType,
        authorId: comment.authorId,
        content: comment.content,
        checklistJson: JSON.stringify(comment.checklist),
        metadataJson: JSON.stringify(comment.metadata),
        createdAt: comment.createdAt
      });
    return comment;
  }
}

function buildAgentReviewPrompt(prompt: string, task: TaskRow | null): string {
  const taskContext = task
    ? [
        `Task: ${task.title}`,
        `Status: ${task.status}`,
        `Priority: ${task.priority}`,
        `Project: ${task.projectName ?? "unknown"}`,
        `Description: ${task.description ?? "none"}`
      ].join("\n")
    : "No task linked.";
  return `${taskContext}\n\nReview request:\n${prompt}`;
}

function buildSynthesisPrompt(task: TaskRow, messages: MessageRecord[], instructions: string | null): string {
  const reviewText = messages
    .map((message) => {
      const agentName = typeof message.metadata.agentName === "string" ? message.metadata.agentName : message.authorType;
      return `## ${agentName}\n${message.content}`;
    })
    .join("\n\n");
  return [
    `Task: ${task.title}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
    `Description: ${task.description ?? "none"}`,
    instructions ? `Extra synthesis instructions: ${instructions}` : null,
    "",
    "Create a concise synthesis and include a markdown checklist using '- [ ] item' lines.",
    "",
    reviewText || "No prior review replies were found."
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseChecklist(content: string): ChecklistItem[] {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const checkboxMatch = line.match(/^\s*[-*]\s+\[([ xX]?)\]\s+(.+)$/);
      if (checkboxMatch) {
        return { checked: checkboxMatch[1]?.toLowerCase() === "x", text: checkboxMatch[2]?.trim() ?? "" };
      }
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
      return bulletMatch ? { checked: false, text: bulletMatch[1]?.trim() ?? "" } : null;
    })
    .filter((item): item is ChecklistItem => Boolean(item?.text));
}

async function runLimited<TInput, TOutput>(
  items: TInput[],
  limit: number,
  work: (item: TInput) => Promise<TOutput>
): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
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

function mapTaskCommentRow(row: TaskCommentRow): TaskCommentRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    channelId: row.channelId,
    messageId: row.messageId,
    authorType: row.authorType,
    authorId: row.authorId,
    content: row.content,
    checklist: parseJsonArray(row.checklistJson),
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

function parseJsonArray(value: string): ChecklistItem[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ChecklistItem[]) : [];
  } catch {
    return [];
  }
}

function safeProviderErrorMessage(error: unknown): string {
  return redactString(error instanceof Error ? error.message : "Provider request failed");
}
