import { CopilotClient } from "@github/copilot-sdk";
import type {
  CopilotClientOptions,
  PermissionHandler,
  ResumeSessionConfig,
  SessionConfig,
  SessionEvent,
  SessionEventHandler
} from "@github/copilot-sdk";
import type { AppSettings } from "../../shared/schemas";
import type { JsonlLogger } from "../logging/logger";
import type { RuntimeRegistry } from "./runtimeRegistry";

export type CopilotSdkSessionHandle = {
  sessionId: string;
  workspacePath?: string;
  on(handler: SessionEventHandler): () => void;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
};

export type CopilotSdkClient = {
  createSession(config: SessionConfig): Promise<CopilotSdkSessionHandle>;
  resumeSession(sessionId: string, config: ResumeSessionConfig): Promise<CopilotSdkSessionHandle>;
  stop(): Promise<Error[]>;
};

export type CopilotSdkClientFactory = (options: CopilotClientOptions) => CopilotSdkClient;

export type CopilotSessionStartInput = {
  sessionId: string;
  cwd: string;
  model: string | null;
  correlationId: string;
  onEvent: SessionEventHandler;
  onPermissionRequest?: PermissionHandler;
};

export type CopilotSessionResumeInput = CopilotSessionStartInput;

export class CopilotSdkAdapter {
  private client: CopilotSdkClient | null = null;
  private readonly activeSessions = new Map<string, CopilotSdkSessionHandle>();

  constructor(
    private readonly logger: JsonlLogger,
    private readonly runtimeRegistry: RuntimeRegistry,
    private readonly getSettings: () => AppSettings,
    private readonly clientFactory: CopilotSdkClientFactory = (options) => new CopilotClient(options)
  ) {}

  async startSession(input: CopilotSessionStartInput): Promise<CopilotSdkSessionHandle> {
    const client = this.getClient();
    const config = this.sessionConfig(input);
    this.logger.info({
      source: "runtime",
      eventName: "copilot.session.start",
      message: "Starting Copilot SDK session",
      correlationId: input.correlationId,
      metadata: { sessionId: input.sessionId, cwd: input.cwd, model: config.model ?? "default" }
    });

    const session = await client.createSession(config);
    this.activeSessions.set(session.sessionId, session);
    return session;
  }

  async resumeSession(input: CopilotSessionResumeInput): Promise<CopilotSdkSessionHandle> {
    const client = this.getClient();
    const config = this.resumeConfig(input);
    this.logger.info({
      source: "runtime",
      eventName: "copilot.session.resume",
      message: "Resuming Copilot SDK session",
      correlationId: input.correlationId,
      metadata: { sessionId: input.sessionId, cwd: input.cwd, model: config.model ?? "default" }
    });

    const session = await client.resumeSession(input.sessionId, config);
    this.activeSessions.set(session.sessionId, session);
    return session;
  }

  async disconnectSession(sessionId: string, correlationId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger.info({
        source: "runtime",
        eventName: "copilot.session.disconnect.cached",
        message: "No active Copilot SDK handle for session; cached state will be marked disconnected",
        correlationId,
        metadata: { sessionId }
      });
      return;
    }

    await session.disconnect();
    this.activeSessions.delete(sessionId);
    this.logger.info({
      source: "runtime",
      eventName: "copilot.session.disconnect",
      message: "Disconnected Copilot SDK session",
      correlationId,
      metadata: { sessionId }
    });
  }

  async abortSession(sessionId: string, correlationId: string): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger.info({
        source: "runtime",
        eventName: "copilot.session.abort.cached",
        message: "No active Copilot SDK handle for session; cached state will be marked aborted",
        correlationId,
        metadata: { sessionId }
      });
      return false;
    }

    await session.abort();
    await session.disconnect();
    this.activeSessions.delete(sessionId);
    this.logger.info({
      source: "runtime",
      eventName: "copilot.session.abort",
      message: "Aborted and disconnected Copilot SDK session",
      correlationId,
      metadata: { sessionId }
    });
    return true;
  }

  async stop(): Promise<void> {
    if (!this.client) {
      return;
    }

    const errors = await this.client.stop();
    if (errors.length > 0) {
      this.logger.warn({
        source: "runtime",
        eventName: "copilot.client.stop.warning",
        message: "Copilot SDK client stopped with cleanup errors",
        metadata: { errors: errors.map((error) => error.message) }
      });
    }
    this.activeSessions.clear();
    this.client = null;
  }

  private getClient(): CopilotSdkClient {
    if (!this.client) {
      this.client = this.clientFactory(this.clientOptions());
    }
    return this.client;
  }

  private clientOptions(): CopilotClientOptions {
    const settings = this.getSettings();
    const cachedCopilot = this.runtimeRegistry.listCached().find((runtime) => runtime.providerType === "copilot");
    const cliPath = settings.copilotCliPath ?? cachedCopilot?.cliPath ?? undefined;
    return {
      cliPath,
      useStdio: true,
      logLevel: settings.logLevel === "debug" ? "debug" : "info"
    };
  }

  private sessionConfig(input: CopilotSessionStartInput): SessionConfig {
    return {
      ...this.commonSessionConfig(input),
      sessionId: input.sessionId
    };
  }

  private resumeConfig(input: CopilotSessionResumeInput): ResumeSessionConfig {
    return this.commonSessionConfig(input);
  }

  private commonSessionConfig(input: CopilotSessionStartInput): Omit<SessionConfig, "sessionId"> {
    return {
      clientName: "Lelio",
      model: input.model ?? undefined,
      workingDirectory: input.cwd,
      streaming: true,
      enableConfigDiscovery: false,
      onPermissionRequest: input.onPermissionRequest ?? denyUntilApprovalsExist,
      onEvent: input.onEvent
    };
  }
}

export const denyUntilApprovalsExist: PermissionHandler = () => ({
  kind: "user-not-available"
});

export function summarizeSessionEvent(event: SessionEvent): string {
  const data = "data" in event ? (event.data as Record<string, unknown>) : {};
  const content = data.content ?? data.deltaContent ?? data.message ?? data.summary ?? data.error;
  return typeof content === "string" && content.trim() ? content : event.type;
}

export function authorForSessionEvent(event: SessionEvent): "assistant" | "user" | "system" {
  if (event.type.startsWith("assistant.")) {
    return "assistant";
  }
  if (event.type.startsWith("user.")) {
    return "user";
  }
  return "system";
}
