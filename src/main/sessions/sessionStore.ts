import crypto from "node:crypto";
import fs from "node:fs";
import type { SessionEvent } from "@github/copilot-sdk";
import type {
  ExecutionRun,
  ExecutionRunStatus,
  GitChangedFilesSummary,
  RunMessage,
  SessionActionResult,
  SessionDetail,
  SessionDetailInput,
  SessionEventRecord,
  SessionRecord,
  SessionStatus,
  Task
} from "../../shared/schemas";
import type { SqliteDatabase } from "../db/sqlite";
import { runTransaction } from "../db/sqlite";
import type { JsonlLogger } from "../logging/logger";
import type { TaskStore } from "../tasks/taskStore";
import type { ProjectMemoryStore } from "../memory/projectMemoryStore";
import type { ApprovalStore } from "../approvals/approvalStore";
import {
  authorForSessionEvent,
  CopilotSdkAdapter,
  summarizeSessionEvent
} from "../runtime/copilotSdkAdapter";
import { getGitChangedFilesSummary, type GitCommandExecutor } from "../projects/gitStatus";
import { buildDeterministicSessionId } from "./sessionIds";

type TaskSessionContext = {
  taskId: string;
  title: string;
  projectId: string;
  projectSlug: string;
  projectPath: string;
  agentId: string;
  agentSlug: string;
  agentProviderType: string;
  agentModel: string | null;
  branch: string | null;
  worktreePath: string | null;
};

type SessionRow = Omit<SessionRecord, "runs">;

type RunRow = Omit<ExecutionRun, "mountedSkills">;

type RunMessageRow = Omit<RunMessage, "metadata"> & { metadataJson: string };

type SessionEventRow = Omit<SessionEventRecord, "metadata"> & { metadataJson: string };
type SessionNotificationSink = {
  notifySessionTerminal(input: { sessionId: string; status: SessionStatus; taskTitle?: string | null }): void;
};

const SESSION_SELECT = `
  SELECT
    id,
    task_id AS taskId,
    project_id AS projectId,
    agent_id AS agentId,
    provider_type AS providerType,
    model,
    external_session_id AS externalSessionId,
    cwd,
    status,
    started_at AS startedAt,
    ended_at AS endedAt,
    last_event_at AS lastEventAt
  FROM sessions
`;

export class SessionStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly logger: JsonlLogger,
    private readonly taskStore: TaskStore,
    private readonly copilotAdapter: CopilotSdkAdapter,
    private readonly memoryStore?: ProjectMemoryStore,
    private readonly approvalStore?: ApprovalStore,
    private readonly gitExecutor?: GitCommandExecutor,
    private readonly notificationSink?: SessionNotificationSink
  ) {}

  list(): SessionRecord[] {
    const rows = this.db
      .prepare(
        `
        ${SESSION_SELECT}
        ORDER BY COALESCE(last_event_at, started_at, ended_at, '') DESC
      `
      )
      .all() as SessionRow[];

    return rows.map((row) => this.withRuns(row));
  }

  async getDetail(input: SessionDetailInput): Promise<SessionDetail> {
    const session = this.getRequiredSession(input.id);
    const changedFiles = input.includeGitSummary ? await this.getChangedFilesForSession(session) : null;

    return {
      session,
      messages: this.listRunMessages(session.id, input.sinceSequenceNumbers),
      events: this.listSessionEvents(session.id, input.sinceEventCreatedAt),
      changedFiles
    };
  }

  async startTaskSession(taskId: string, correlationId: string): Promise<SessionActionResult> {
    const context = this.getTaskSessionContext(taskId);
    const sessionId = buildDeterministicSessionId({
      projectSlug: context.projectSlug,
      taskId: context.taskId,
      agentSlug: context.agentSlug
    });
    const now = new Date().toISOString();
    const cwd = this.resolveCwd(context);

    this.upsertSession({
      context,
      sessionId,
      cwd,
      status: "running",
      timestamp: now,
      startedAt: now,
      endedAt: null
    });
    const run = this.createRun(context, sessionId, "running", now);
    const mountedSkills = this.mountSkillsForRun(context, sessionId, run.id, cwd, correlationId);
    this.recordLifecycleEvent(sessionId, "session.start.requested", "Copilot SDK session start requested", { taskId }, now);
    if (mountedSkills.length > 0) {
      this.recordLifecycleEvent(
        sessionId,
        "session.skills.mounted",
        `${mountedSkills.length} approved skills mounted before session start`,
        { runId: run.id, mountedSkills },
        now
      );
    }

    try {
      const session = await this.copilotAdapter.startSession({
        sessionId,
        cwd,
        model: this.modelForContext(context),
        correlationId,
        onEvent: (event) => this.handleSdkEvent(sessionId, run.id, event),
        onPermissionRequest: this.approvalStore?.createPermissionHandler({
          sessionId,
          taskId,
          runId: run.id,
          correlationId
        })
      });
      const timestamp = new Date().toISOString();
      this.markSessionAndRun(session.sessionId, run.id, "idle", "idle", timestamp);
      this.recordLifecycleEvent(session.sessionId, "session.started", "Copilot SDK session started", { workspacePath: session.workspacePath }, timestamp);
      this.logger.info({
        source: "session",
        eventName: "session.start",
        message: "Task session started",
        correlationId,
        metadata: { taskId, sessionId: session.sessionId, runId: run.id }
      });
      return this.resultForTask(taskId);
    } catch (error) {
      this.markFailure(sessionId, run.id, error, correlationId, "session.start.failure");
      throw new Error(`Copilot session start failed: ${errorMessage(error)}`);
    }
  }

  async resumeTaskSession(taskId: string, correlationId: string): Promise<SessionActionResult> {
    const context = this.getTaskSessionContext(taskId);
    const existing = this.getLatestSessionForTask(taskId);
    if (!existing) {
      throw new Error(`No Copilot session exists for task: ${taskId}`);
    }

    const now = new Date().toISOString();
    const cwd = existing.cwd ?? this.resolveCwd(context);
    const run = this.createRun(context, existing.id, "running", now);
    const mountedSkills = this.mountSkillsForRun(context, existing.id, run.id, cwd, correlationId);
    this.updateSession(existing.id, "running", now, null);
    this.recordLifecycleEvent(existing.id, "session.resume.requested", "Copilot SDK session resume requested", { taskId }, now);
    if (mountedSkills.length > 0) {
      this.recordLifecycleEvent(
        existing.id,
        "session.skills.mounted",
        `${mountedSkills.length} approved skills mounted before session resume`,
        { runId: run.id, mountedSkills },
        now
      );
    }

    try {
      const session = await this.copilotAdapter.resumeSession({
        sessionId: existing.id,
        cwd,
        model: this.modelForContext(context),
        correlationId,
        onEvent: (event) => this.handleSdkEvent(existing.id, run.id, event),
        onPermissionRequest: this.approvalStore?.createPermissionHandler({
          sessionId: existing.id,
          taskId,
          runId: run.id,
          correlationId
        })
      });
      const timestamp = new Date().toISOString();
      this.markSessionAndRun(session.sessionId, run.id, "idle", "idle", timestamp);
      this.recordLifecycleEvent(session.sessionId, "session.resumed", "Copilot SDK session resumed", { workspacePath: session.workspacePath }, timestamp);
      this.logger.info({
        source: "session",
        eventName: "session.resume",
        message: "Task session resumed",
        correlationId,
        metadata: { taskId, sessionId: session.sessionId, runId: run.id }
      });
      return this.resultForTask(taskId);
    } catch (error) {
      this.markFailure(existing.id, run.id, error, correlationId, "session.resume.failure");
      throw new Error(`Copilot session resume failed: ${errorMessage(error)}`);
    }
  }

  async disconnectTaskSession(taskId: string, correlationId: string): Promise<SessionActionResult> {
    const existing = this.getLatestSessionForTask(taskId);
    if (!existing) {
      throw new Error(`No Copilot session exists for task: ${taskId}`);
    }

    return this.disconnectSession(existing.id, correlationId);
  }

  async disconnectSession(sessionId: string, correlationId: string): Promise<SessionActionResult> {
    const existing = this.getRequiredSession(sessionId);

    try {
      this.approvalStore?.cancelPendingForSession(existing.id, "session_disconnected", correlationId);
      await this.copilotAdapter.disconnectSession(existing.id, correlationId);
      const timestamp = new Date().toISOString();
      this.updateSession(existing.id, "disconnected", timestamp, timestamp);
      this.closeLatestOpenRun(existing.id, "disconnected", timestamp, "disconnected");
      this.recordLifecycleEvent(existing.id, "session.disconnected", "Copilot SDK session disconnected", { taskId: existing.taskId }, timestamp);
      this.logger.info({
        source: "session",
        eventName: "session.disconnect",
        message: "Task session disconnected",
        correlationId,
        metadata: { taskId: existing.taskId, sessionId: existing.id }
      });
      return this.resultForSession(existing.id);
    } catch (error) {
      this.logger.exception({
        source: "session",
        eventName: "session.disconnect.failure",
        message: "Task session disconnect failed",
        correlationId,
        error,
        metadata: { taskId: existing.taskId, sessionId: existing.id }
      });
      throw new Error(`Copilot session disconnect failed: ${errorMessage(error)}`);
    }
  }

  async abortSession(sessionId: string, correlationId: string): Promise<SessionActionResult> {
    const existing = this.getRequiredSession(sessionId);

    try {
      this.approvalStore?.cancelPendingForSession(existing.id, "session_aborted", correlationId);
      const activeHandleAborted = await this.copilotAdapter.abortSession(existing.id, correlationId);
      const timestamp = new Date().toISOString();
      this.updateSession(existing.id, "aborted", timestamp, timestamp);
      this.closeLatestOpenRun(existing.id, "aborted", timestamp, activeHandleAborted ? "aborted" : "aborted-no-active-handle");
      this.recordLifecycleEvent(
        existing.id,
        "session.aborted",
        activeHandleAborted ? "Copilot SDK session aborted" : "Cached session marked aborted; no active SDK handle was attached",
        { taskId: existing.taskId, activeHandleAborted },
        timestamp
      );
      this.logger.info({
        source: "session",
        eventName: "session.abort",
        message: "Task session aborted",
        correlationId,
        metadata: { taskId: existing.taskId, sessionId: existing.id, activeHandleAborted }
      });
      this.notifyTerminalStatus(existing.id, "aborted");
      return this.resultForSession(existing.id);
    } catch (error) {
      this.logger.exception({
        source: "session",
        eventName: "session.abort.failure",
        message: "Task session abort failed",
        correlationId,
        error,
        metadata: { taskId: existing.taskId, sessionId: existing.id }
      });
      throw new Error(`Copilot session abort failed: ${errorMessage(error)}`);
    }
  }

  async stop(): Promise<void> {
    this.approvalStore?.cancelAllPending("app_shutdown", "app-shutdown");
    await this.copilotAdapter.stop();
  }

  private resultForTask(taskId: string): SessionActionResult {
    const task = this.taskStore.getRequired(taskId);
    const session = this.getLatestSessionForTask(taskId);
    if (!session) {
      throw new Error(`Session not found for task: ${taskId}`);
    }
    return { task, session };
  }

  private resultForSession(sessionId: string): SessionActionResult {
    const session = this.getRequiredSession(sessionId);
    if (!session.taskId) {
      throw new Error(`Session is not linked to a task: ${sessionId}`);
    }
    const task = this.taskStore.getRequired(session.taskId);
    return { task, session };
  }

  private getTaskSessionContext(taskId: string): TaskSessionContext {
    const row = this.db
      .prepare(
        `
        SELECT
          t.id AS taskId,
          t.title,
          t.branch,
          t.worktree_path AS worktreePath,
          p.id AS projectId,
          p.slug AS projectSlug,
          p.path AS projectPath,
          a.id AS agentId,
          a.slug AS agentSlug,
          a.provider_type AS agentProviderType,
          a.model AS agentModel
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN agent_profiles a ON a.id = t.assignee_agent_id
        WHERE t.id = ?
      `
      )
      .get(taskId) as TaskSessionContext | undefined;

    if (!row) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!row.projectId) {
      throw new Error("Task must be linked to a project before starting a Copilot session");
    }
    if (!row.agentId) {
      throw new Error("Task must be assigned to a Copilot-backed agent before starting a session");
    }
    if (row.agentProviderType !== "copilot") {
      throw new Error(`Phase 3 supports Copilot-backed agents only, but task is assigned to ${row.agentProviderType}`);
    }

    return row;
  }

  private resolveCwd(context: TaskSessionContext): string {
    const preferred = context.worktreePath ?? context.projectPath;
    if (!fs.existsSync(preferred)) {
      throw new Error(`Session working directory does not exist: ${preferred}`);
    }
    return preferred;
  }

  private modelForContext(context: TaskSessionContext): string | null {
    return context.agentModel && context.agentModel !== "default" ? context.agentModel : null;
  }

  private upsertSession(input: {
    context: TaskSessionContext;
    sessionId: string;
    cwd: string;
    status: SessionStatus;
    timestamp: string;
    startedAt: string;
    endedAt: string | null;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO sessions (
          id, task_id, project_id, agent_id, provider_type, model, external_session_id,
          cwd, status, started_at, ended_at, last_event_at
        ) VALUES (
          @sessionId, @taskId, @projectId, @agentId, 'copilot', @model, @sessionId,
          @cwd, @status, @startedAt, @endedAt, @timestamp
        )
        ON CONFLICT(id) DO UPDATE SET
          task_id = excluded.task_id,
          project_id = excluded.project_id,
          agent_id = excluded.agent_id,
          provider_type = excluded.provider_type,
          model = excluded.model,
          external_session_id = excluded.external_session_id,
          cwd = excluded.cwd,
          status = excluded.status,
          started_at = COALESCE(sessions.started_at, excluded.started_at),
          ended_at = excluded.ended_at,
          last_event_at = excluded.last_event_at
      `
      )
      .run({
        sessionId: input.sessionId,
        taskId: input.context.taskId,
        projectId: input.context.projectId,
        agentId: input.context.agentId,
        model: this.modelForContext(input.context),
        cwd: input.cwd,
        status: input.status,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        timestamp: input.timestamp
      });
  }

  private createRun(
    context: TaskSessionContext,
    sessionId: string,
    status: ExecutionRunStatus,
    startedAt: string
  ): ExecutionRun {
    const attemptNumber =
      ((this.db
        .prepare("SELECT COALESCE(MAX(attempt_number), 0) AS attemptNumber FROM execution_runs WHERE task_id = ? AND session_id = ?")
        .get(context.taskId, sessionId) as { attemptNumber: number }).attemptNumber ?? 0) + 1;
    const run: ExecutionRun = {
      id: `run-${crypto.randomUUID()}`,
      taskId: context.taskId,
      sessionId,
      attemptNumber,
      worktreePath: context.worktreePath ?? null,
      status,
      startedAt,
      endedAt: null,
      exitReason: null,
      lastSequenceNumber: 0,
      mountedSkills: []
    };

    this.db
      .prepare(
        `
        INSERT INTO execution_runs (
          id, task_id, session_id, attempt_number, worktree_path, status,
          started_at, ended_at, exit_reason, last_sequence_number
        ) VALUES (
          @id, @taskId, @sessionId, @attemptNumber, @worktreePath, @status,
          @startedAt, @endedAt, @exitReason, @lastSequenceNumber
        )
      `
      )
      .run({
        id: run.id,
        taskId: run.taskId,
        sessionId: run.sessionId,
        attemptNumber: run.attemptNumber,
        worktreePath: run.worktreePath,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        exitReason: run.exitReason,
        lastSequenceNumber: run.lastSequenceNumber
      });

    return run;
  }

  private mountSkillsForRun(
    context: TaskSessionContext,
    sessionId: string,
    runId: string,
    cwd: string,
    correlationId: string
  ) {
    if (!this.memoryStore) {
      return [];
    }
    try {
      return this.memoryStore.mountSkillsForRun({
        runId,
        projectId: context.projectId,
        agentId: context.agentId,
        providerType: context.agentProviderType,
        cwd,
        correlationId
      });
    } catch (error) {
      this.markFailure(sessionId, runId, error, correlationId, "session.skills.mount.failure");
      throw new Error(`Skill mount failed: ${errorMessage(error)}`);
    }
  }

  private handleSdkEvent(sessionId: string, runId: string, event: SessionEvent): void {
    this.approvalStore?.recordPermissionEvent(sessionId, event);
    this.recordSdkEvent(sessionId, runId, event);
  }

  private recordSdkEvent(sessionId: string, runId: string, event: SessionEvent): void {
    const timestamp = new Date().toISOString();
    const content = summarizeSessionEvent(event);
    const status = statusForEvent(event);

    runTransaction(this.db, () => {
      this.recordSessionEventInTransaction(sessionId, event.type, content, event, timestamp);
      this.appendRunMessageInTransaction(runId, authorForSessionEvent(event), event.type, content, event, timestamp);
      if (status) {
        this.updateSessionInTransaction(sessionId, status.sessionStatus, timestamp, status.sessionEndedAt ? timestamp : null);
        this.updateRunInTransaction(runId, status.runStatus, timestamp, status.runEndedAt ? timestamp : null, status.exitReason);
      } else {
        this.db.prepare("UPDATE sessions SET last_event_at = ? WHERE id = ?").run(timestamp, sessionId);
      }
    });
    if (status?.sessionEndedAt) {
      this.notifyTerminalStatus(sessionId, status.sessionStatus);
    }
  }

  private recordLifecycleEvent(sessionId: string, eventType: string, content: string, metadata: unknown, timestamp: string): void {
    this.db
      .prepare(
        `
        INSERT INTO session_events (id, session_id, event_type, content, metadata_json, created_at)
        VALUES (@id, @sessionId, @eventType, @content, @metadataJson, @createdAt)
      `
      )
      .run({
        id: `session-event-${crypto.randomUUID()}`,
        sessionId,
        eventType,
        content,
        metadataJson: toJson(metadata),
        createdAt: timestamp
      });
  }

  private recordSessionEventInTransaction(
    sessionId: string,
    eventType: string,
    content: string,
    metadata: unknown,
    timestamp: string
  ): void {
    this.db
      .prepare(
        `
        INSERT INTO session_events (id, session_id, event_type, content, metadata_json, created_at)
        VALUES (@id, @sessionId, @eventType, @content, @metadataJson, @createdAt)
      `
      )
      .run({
        id: `session-event-${crypto.randomUUID()}`,
        sessionId,
        eventType,
        content,
        metadataJson: toJson(metadata),
        createdAt: timestamp
      });
  }

  private appendRunMessageInTransaction(
    runId: string,
    authorType: "assistant" | "user" | "system",
    contentType: string,
    content: string,
    metadata: unknown,
    timestamp: string
  ): void {
    const current =
      (this.db
        .prepare("SELECT last_sequence_number AS lastSequenceNumber FROM execution_runs WHERE id = ?")
        .get(runId) as { lastSequenceNumber: number } | undefined)?.lastSequenceNumber ?? 0;
    const sequenceNumber = current + 1;

    this.db
      .prepare("UPDATE execution_runs SET last_sequence_number = ? WHERE id = ?")
      .run(sequenceNumber, runId);
    this.db
      .prepare(
        `
        INSERT INTO run_messages (
          id, run_id, sequence_number, author_type, content_type, content, metadata_json, created_at
        ) VALUES (
          @id, @runId, @sequenceNumber, @authorType, @contentType, @content, @metadataJson, @createdAt
        )
      `
      )
      .run({
        id: `run-message-${crypto.randomUUID()}`,
        runId,
        sequenceNumber,
        authorType,
        contentType,
        content,
        metadataJson: toJson(metadata),
        createdAt: timestamp
      });
  }

  private markSessionAndRun(
    sessionId: string,
    runId: string,
    sessionStatus: SessionStatus,
    runStatus: ExecutionRunStatus,
    timestamp: string
  ): void {
    runTransaction(this.db, () => {
      this.updateSessionInTransaction(sessionId, sessionStatus, timestamp, null);
      this.updateRunInTransaction(runId, runStatus, timestamp, null, null);
    });
  }

  private markFailure(sessionId: string, runId: string, error: unknown, correlationId: string, eventName: string): void {
    const timestamp = new Date().toISOString();
    const message = errorMessage(error);
    runTransaction(this.db, () => {
      this.updateSessionInTransaction(sessionId, "failed", timestamp, timestamp);
      this.updateRunInTransaction(runId, "failed", timestamp, timestamp, message);
      this.recordSessionEventInTransaction(sessionId, eventName, message, { error: message }, timestamp);
      this.appendRunMessageInTransaction(runId, "system", eventName, message, { error: message }, timestamp);
    });
    this.logger.exception({
      source: "session",
      eventName,
      message: "Copilot SDK session action failed",
      correlationId,
      error,
      metadata: { sessionId, runId }
    });
    this.notifyTerminalStatus(sessionId, "failed");
  }

  private notifyTerminalStatus(sessionId: string, status: SessionStatus): void {
    if (!this.notificationSink) {
      return;
    }
    const row = this.db
      .prepare(
        `
        SELECT t.title AS taskTitle
        FROM sessions s
        LEFT JOIN tasks t ON t.id = s.task_id
        WHERE s.id = ?
      `
      )
      .get(sessionId) as { taskTitle: string | null } | undefined;
    this.notificationSink.notifySessionTerminal({ sessionId, status, taskTitle: row?.taskTitle ?? null });
  }

  private updateSession(sessionId: string, status: SessionStatus, lastEventAt: string, endedAt: string | null): void {
    this.db
      .prepare(
        `
        UPDATE sessions
        SET status = @status,
            last_event_at = @lastEventAt,
            ended_at = @endedAt
        WHERE id = @sessionId
      `
      )
      .run({ sessionId, status, lastEventAt, endedAt });
  }

  private updateSessionInTransaction(
    sessionId: string,
    status: SessionStatus,
    lastEventAt: string,
    endedAt: string | null
  ): void {
    this.db
      .prepare(
        `
        UPDATE sessions
        SET status = @status,
            last_event_at = @lastEventAt,
            ended_at = COALESCE(@endedAt, ended_at)
        WHERE id = @sessionId
      `
      )
      .run({ sessionId, status, lastEventAt, endedAt });
  }

  private updateRunInTransaction(
    runId: string,
    status: ExecutionRunStatus,
    _timestamp: string,
    endedAt: string | null,
    exitReason: string | null
  ): void {
    this.db
      .prepare(
        `
        UPDATE execution_runs
        SET status = @status,
            ended_at = COALESCE(@endedAt, ended_at),
            exit_reason = COALESCE(@exitReason, exit_reason)
        WHERE id = @runId
      `
      )
      .run({ runId, status, endedAt, exitReason });
  }

  private closeLatestOpenRun(
    sessionId: string,
    status: ExecutionRunStatus,
    timestamp: string,
    exitReason: string
  ): void {
    const run = this.db
      .prepare(
        `
        SELECT id
        FROM execution_runs
        WHERE session_id = ? AND ended_at IS NULL
        ORDER BY attempt_number DESC
        LIMIT 1
      `
      )
      .get(sessionId) as { id: string } | undefined;

    if (run) {
      this.db
        .prepare("UPDATE execution_runs SET status = ?, ended_at = ?, exit_reason = ? WHERE id = ?")
        .run(status, timestamp, exitReason, run.id);
    }
  }

  private getRequiredSession(sessionId: string): SessionRecord {
    const row = this.db
      .prepare(
        `
        ${SESSION_SELECT}
        WHERE id = ?
        LIMIT 1
      `
      )
      .get(sessionId) as SessionRow | undefined;

    if (!row) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return this.withRuns(row);
  }

  private listRunMessages(sessionId: string, sinceSequenceNumbers?: Record<string, number>): RunMessage[] {
    const cursors = sinceSequenceNumbers ?? {};
    if (Object.keys(cursors).length > 0) {
      const runs = this.db
        .prepare(
          `
          SELECT id, attempt_number AS attemptNumber
          FROM execution_runs
          WHERE session_id = ?
          ORDER BY attempt_number ASC
        `
        )
        .all(sessionId) as Array<{ id: string; attemptNumber: number }>;
      const rows = runs.flatMap((run) => this.listRunMessagesAfter(run.id, cursors[run.id] ?? 0));
      return rows
        .sort((left, right) => left.attemptNumber - right.attemptNumber || left.sequenceNumber - right.sequenceNumber)
        .slice(0, 250)
        .map(mapRunMessageRow);
    }

    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM (
          SELECT
            rm.id,
            rm.run_id AS runId,
            er.attempt_number AS attemptNumber,
            rm.sequence_number AS sequenceNumber,
            rm.author_type AS authorType,
            rm.content_type AS contentType,
            rm.content,
            rm.metadata_json AS metadataJson,
            rm.created_at AS createdAt
          FROM run_messages rm
          JOIN execution_runs er ON er.id = rm.run_id
          WHERE er.session_id = ?
          ORDER BY er.attempt_number DESC, rm.sequence_number DESC
          LIMIT 250
        )
        ORDER BY attemptNumber ASC, sequenceNumber ASC
      `
      )
      .all(sessionId) as RunMessageRow[];

    return rows.map(mapRunMessageRow);
  }

  private listRunMessagesAfter(runId: string, sinceSequenceNumber: number): RunMessageRow[] {
    return this.db
      .prepare(
        `
        SELECT
          rm.id,
          rm.run_id AS runId,
          er.attempt_number AS attemptNumber,
          rm.sequence_number AS sequenceNumber,
          rm.author_type AS authorType,
          rm.content_type AS contentType,
          rm.content,
          rm.metadata_json AS metadataJson,
          rm.created_at AS createdAt
        FROM run_messages rm
        JOIN execution_runs er ON er.id = rm.run_id
        WHERE rm.run_id = ? AND rm.sequence_number > ?
        ORDER BY rm.sequence_number ASC
        LIMIT 250
      `
      )
      .all(runId, sinceSequenceNumber) as RunMessageRow[];
  }

  private listSessionEvents(sessionId: string, sinceEventCreatedAt?: string): SessionEventRecord[] {
    const rows = sinceEventCreatedAt
      ? (this.db
          .prepare(
            `
            SELECT
              id,
              session_id AS sessionId,
              event_type AS eventType,
              content,
              metadata_json AS metadataJson,
              created_at AS createdAt
            FROM session_events
            WHERE session_id = ? AND created_at > ?
            ORDER BY created_at ASC, id ASC
            LIMIT 100
          `
          )
          .all(sessionId, sinceEventCreatedAt) as SessionEventRow[])
      : (this.db
          .prepare(
            `
            SELECT *
            FROM (
              SELECT
                id,
                session_id AS sessionId,
                event_type AS eventType,
                content,
                metadata_json AS metadataJson,
                created_at AS createdAt
              FROM session_events
              WHERE session_id = ?
              ORDER BY created_at DESC, id DESC
              LIMIT 100
            )
            ORDER BY createdAt ASC, id ASC
          `
          )
          .all(sessionId) as SessionEventRow[]);

    return rows.map(mapSessionEventRow);
  }

  private async getChangedFilesForSession(session: SessionRecord): Promise<GitChangedFilesSummary> {
    const gitPath = this.resolveGitPath(session);
    if (!gitPath) {
      return {
        status: "unknown",
        branch: null,
        checkedAt: new Date().toISOString(),
        totalCount: 0,
        files: [],
        truncated: false,
        error: "Session has no working directory or project path"
      };
    }

    return getGitChangedFilesSummary(gitPath, this.gitExecutor);
  }

  private resolveGitPath(session: SessionRecord): string | null {
    if (session.cwd) {
      return session.cwd;
    }
    if (!session.projectId) {
      return null;
    }
    const row = this.db.prepare("SELECT path FROM projects WHERE id = ?").get(session.projectId) as { path: string } | undefined;
    return row?.path ?? null;
  }

  private getLatestSessionForTask(taskId: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `
        ${SESSION_SELECT}
        WHERE task_id = ?
        ORDER BY COALESCE(last_event_at, started_at, ended_at, '') DESC
        LIMIT 1
      `
      )
      .get(taskId) as SessionRow | undefined;

    return row ? this.withRuns(row) : null;
  }

  private withRuns(row: SessionRow): SessionRecord {
    const runs = this.db
      .prepare(
        `
        SELECT
          id,
          task_id AS taskId,
          session_id AS sessionId,
          attempt_number AS attemptNumber,
          worktree_path AS worktreePath,
          status,
          started_at AS startedAt,
          ended_at AS endedAt,
          exit_reason AS exitReason,
          last_sequence_number AS lastSequenceNumber
        FROM execution_runs
        WHERE session_id = ?
        ORDER BY attempt_number DESC
      `
      )
      .all(row.id) as RunRow[];

    return {
      ...row,
      status: row.status as SessionStatus,
      runs: runs.map((run) => ({
        ...run,
        status: run.status as ExecutionRunStatus,
        mountedSkills: this.memoryStore?.listRunSkillMounts(run.id) ?? []
      }))
    };
  }
}

function mapRunMessageRow(row: RunMessageRow): RunMessage {
  return {
    id: row.id,
    runId: row.runId,
    attemptNumber: row.attemptNumber,
    sequenceNumber: row.sequenceNumber,
    authorType: row.authorType,
    contentType: row.contentType,
    content: row.content,
    metadata: parseJson(row.metadataJson),
    createdAt: row.createdAt
  };
}

function mapSessionEventRow(row: SessionEventRow): SessionEventRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    eventType: row.eventType,
    content: row.content,
    metadata: parseJson(row.metadataJson),
    createdAt: row.createdAt
  };
}

function statusForEvent(event: SessionEvent):
  | {
      sessionStatus: SessionStatus;
      runStatus: ExecutionRunStatus;
      sessionEndedAt: boolean;
      runEndedAt: boolean;
      exitReason: string | null;
    }
  | null {
  if (event.type === "session.idle") {
    return { sessionStatus: "idle", runStatus: "idle", sessionEndedAt: false, runEndedAt: false, exitReason: null };
  }
  if (event.type === "session.error") {
    return { sessionStatus: "failed", runStatus: "failed", sessionEndedAt: true, runEndedAt: true, exitReason: summarizeSessionEvent(event) };
  }
  if (isSessionEventType(event, "session.complete", "session.completed", "session.finish", "session.finished")) {
    return { sessionStatus: "completed", runStatus: "completed", sessionEndedAt: true, runEndedAt: true, exitReason: summarizeSessionEvent(event) };
  }
  if (event.type === "session.start" || event.type === "user.message") {
    return { sessionStatus: "running", runStatus: "running", sessionEndedAt: false, runEndedAt: false, exitReason: null };
  }
  return null;
}

function isSessionEventType(event: SessionEvent, ...types: string[]): boolean {
  return types.includes(event.type);
}

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { invalidJson: true };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Copilot SDK error";
}
