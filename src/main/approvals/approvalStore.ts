import crypto from "node:crypto";
import type { PermissionHandler, PermissionRequest, PermissionRequestResult, SessionEvent } from "@github/copilot-sdk";
import type {
  ApprovalDecisionInput,
  ApprovalDecisionResult,
  ApprovalListInput,
  ApprovalRecord,
  ApprovalRiskLevel,
  ApprovalStatus
} from "../../shared/schemas";
import type { SqliteDatabase } from "../db/sqlite";
import { runTransaction } from "../db/sqlite";
import type { JsonlLogger } from "../logging/logger";
import { redactValue } from "../logging/redaction";

type ApprovalRow = Omit<ApprovalRecord, "request" | "response" | "metadata"> & {
  requestJson: string;
  responseJson: string | null;
  metadataJson: string;
};

type ApprovalGateContext = {
  sessionId: string;
  taskId: string | null;
  runId: string | null;
  correlationId: string;
};

type SqlParam = string | number | null;

type PermissionRequestedData = {
  requestId?: unknown;
  permissionRequest?: unknown;
  promptRequest?: unknown;
  resolvedByHook?: unknown;
};

type Waiter = (result: PermissionRequestResult) => void;
type EventWaiter = (data: PermissionRequestedData | null) => void;
type ApprovalRequestedListener = (approval: ApprovalRecord) => void;

const DEFAULT_PERMISSION_EVENT_WAIT_MS = 500;

export class ApprovalStore {
  private readonly decisionWaiters = new Map<string, Set<Waiter>>();
  private readonly permissionEvents = new Map<string, PermissionRequestedData>();
  private readonly eventWaiters = new Map<string, Set<EventWaiter>>();

  constructor(
    private readonly db: SqliteDatabase,
    private readonly logger: JsonlLogger,
    private readonly permissionEventWaitMs = DEFAULT_PERMISSION_EVENT_WAIT_MS,
    private readonly onApprovalRequested?: ApprovalRequestedListener
  ) {}

  list(input: ApprovalListInput = {}): ApprovalRecord[] {
    const filters = input ?? {};
    const conditions: string[] = [];
    const params: Record<string, SqlParam> = { limit: filters.limit ?? 100 };
    if (filters.status) {
      conditions.push("status = @status");
      params.status = filters.status;
    }
    if (filters.taskId) {
      conditions.push("task_id = @taskId");
      params.taskId = filters.taskId;
    }
    if (filters.sessionId) {
      conditions.push("session_id = @sessionId");
      params.sessionId = filters.sessionId;
    }

    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          session_id AS sessionId,
          task_id AS taskId,
          run_id AS runId,
          request_id AS requestId,
          tool_call_id AS toolCallId,
          action_type AS actionType,
          summary,
          risk_level AS riskLevel,
          status,
          request_json AS requestJson,
          response_json AS responseJson,
          resolution_reason AS resolutionReason,
          metadata_json AS metadataJson,
          requested_at AS requestedAt,
          resolved_at AS resolvedAt
        FROM approvals
        ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY requested_at DESC, id DESC
        LIMIT @limit
      `
      )
      .all(params) as ApprovalRow[];
    return rows.map(mapApprovalRow);
  }

  decide(input: ApprovalDecisionInput, correlationId: string): ApprovalDecisionResult {
    const existing = this.getRequired(input.approvalId);
    if (existing.status !== "pending") {
      return { approval: existing, resolvedLiveRequest: false };
    }

    const now = new Date().toISOString();
    const status: ApprovalStatus = input.decision === "approve" ? "approved" : "denied";
    const feedback = input.feedback?.trim() || null;
    const response = permissionResultForDecision(input.decision, feedback);
    this.db
      .prepare(
        `
        UPDATE approvals
        SET status = @status,
            response_json = @responseJson,
            resolution_reason = @resolutionReason,
            resolved_at = @resolvedAt
        WHERE id = @id AND status = 'pending'
      `
      )
      .run({
        id: input.approvalId,
        status,
        responseJson: toJson(response),
        resolutionReason: feedback ?? (status === "approved" ? "Approved by user" : "Denied by user"),
        resolvedAt: now
      });

    const approval = this.getRequired(input.approvalId);
    const resolvedLiveRequest = this.resolveDecisionWaiters(approval.id, response);
    this.recordAuditMessage(
      approval,
      status === "approved" ? "approval.approved" : "approval.denied",
      status === "approved" ? `Approved: ${approval.summary}` : `Denied: ${approval.summary}`,
      { approvalId: approval.id, decision: input.decision, feedback, resolvedLiveRequest },
      now
    );
    this.logger.info({
      source: "approval",
      eventName: status === "approved" ? "approval.approved" : "approval.denied",
      message: "Approval decision persisted",
      correlationId,
      metadata: { approvalId: approval.id, sessionId: approval.sessionId, taskId: approval.taskId, status, resolvedLiveRequest }
    });
    return { approval, resolvedLiveRequest };
  }

  createPermissionHandler(context: ApprovalGateContext): PermissionHandler {
    return async (request: PermissionRequest, invocation): Promise<PermissionRequestResult> =>
      this.requestPermission(
        {
          ...context,
          sessionId: invocation.sessionId || context.sessionId
        },
        request
      );
  }

  recordPermissionEvent(sessionId: string, event: SessionEvent): void {
    if (event.type !== "permission.requested") {
      return;
    }
    const data = ("data" in event ? event.data : {}) as PermissionRequestedData;
    if (data.resolvedByHook) {
      return;
    }
    const permissionRequest = data.permissionRequest;
    if (!permissionRequest || typeof permissionRequest !== "object") {
      return;
    }
    const key = requestKey(sessionId, permissionRequest);
    this.permissionEvents.set(key, data);
    const waiters = this.eventWaiters.get(key);
    if (!waiters) {
      return;
    }
    this.eventWaiters.delete(key);
    for (const waiter of waiters) {
      waiter(data);
    }
  }

  cancelPendingForSession(sessionId: string, reason: string, correlationId: string): ApprovalRecord[] {
    const pending = this.list({ sessionId, status: "pending", limit: 200 });
    if (pending.length === 0) {
      return [];
    }
    const now = new Date().toISOString();
    const cancelled: ApprovalRecord[] = [];
    for (const approval of pending) {
      this.db
        .prepare(
          `
          UPDATE approvals
          SET status = 'cancelled',
              response_json = @responseJson,
              resolution_reason = @resolutionReason,
              resolved_at = @resolvedAt
          WHERE id = @id AND status = 'pending'
        `
        )
        .run({
          id: approval.id,
          responseJson: toJson({ kind: "user-not-available", reason }),
          resolutionReason: reason,
          resolvedAt: now
        });
      const updated = this.getRequired(approval.id);
      cancelled.push(updated);
      this.resolveDecisionWaiters(updated.id, { kind: "user-not-available" });
      this.recordAuditMessage(updated, "approval.cancelled", `Approval cancelled: ${updated.summary}`, { approvalId: updated.id, reason }, now);
    }
    this.logger.info({
      source: "approval",
      eventName: "approval.cancel.pending-session",
      message: "Pending approvals cancelled for session",
      correlationId,
      metadata: { sessionId, count: cancelled.length, reason }
    });
    return cancelled;
  }

  cancelAllPending(reason: string, correlationId: string): ApprovalRecord[] {
    const pending = this.list({ status: "pending", limit: 200 });
    const bySession = new Set(pending.map((approval) => approval.sessionId).filter((sessionId): sessionId is string => Boolean(sessionId)));
    const cancelled = Array.from(bySession).flatMap((sessionId) => this.cancelPendingForSession(sessionId, reason, correlationId));
    const sessionless = pending.filter((approval) => !approval.sessionId);
    if (sessionless.length === 0) {
      return cancelled;
    }
    const now = new Date().toISOString();
    for (const approval of sessionless) {
      this.db
        .prepare(
          `
          UPDATE approvals
          SET status = 'cancelled',
              response_json = @responseJson,
              resolution_reason = @resolutionReason,
              resolved_at = @resolvedAt
          WHERE id = @id AND status = 'pending'
        `
        )
        .run({
          id: approval.id,
          responseJson: toJson({ kind: "user-not-available", reason }),
          resolutionReason: reason,
          resolvedAt: now
        });
      const updated = this.getRequired(approval.id);
      cancelled.push(updated);
      this.resolveDecisionWaiters(updated.id, { kind: "user-not-available" });
    }
    return cancelled;
  }

  private async requestPermission(context: ApprovalGateContext, thinRequest: PermissionRequest): Promise<PermissionRequestResult> {
    const key = requestKey(context.sessionId, thinRequest);
    const eventData = await this.waitForPermissionEvent(key);
    const request = eventData?.permissionRequest ?? thinRequest;
    const requestId = stringOrNull(eventData?.requestId);
    const existing = requestId ? this.getBySessionRequestId(context.sessionId, requestId) : null;
    if (existing) {
      return resultForPersistedApproval(existing, () => this.waitForDecision(existing));
    }

    const now = new Date().toISOString();
    const approvalId = `approval-${crypto.randomUUID()}`;
    const approvalInput = {
      id: approvalId,
      sessionId: context.sessionId,
      taskId: context.taskId,
      runId: context.runId,
      requestId,
      toolCallId: stringOrNull((request as Record<string, unknown>).toolCallId),
      actionType: stringOrNull((request as Record<string, unknown>).kind) ?? "unknown",
      summary: summarizePermissionRequest(request),
      riskLevel: riskForPermissionRequest(request),
      status: "pending" as ApprovalStatus,
      requestJson: toJson(safeJsonObject({ permissionRequest: request, promptRequest: eventData?.promptRequest ?? null })),
      responseJson: null,
      resolutionReason: null,
      metadataJson: toJson({ source: "copilot-permission-hook", correlationId: context.correlationId }),
      requestedAt: now,
      resolvedAt: null
    };

    this.db
      .prepare(
        `
        INSERT OR IGNORE INTO approvals (
          id, session_id, task_id, run_id, request_id, tool_call_id,
          action_type, summary, risk_level, status,
          request_json, response_json, resolution_reason, metadata_json,
          requested_at, resolved_at
        ) VALUES (
          @id, @sessionId, @taskId, @runId, @requestId, @toolCallId,
          @actionType, @summary, @riskLevel, @status,
          @requestJson, @responseJson, @resolutionReason, @metadataJson,
          @requestedAt, @resolvedAt
        )
      `
      )
      .run(approvalInput);

    const approval = requestId ? this.getBySessionRequestId(context.sessionId, requestId) ?? this.getRequired(approvalId) : this.getRequired(approvalId);
    if (approval.status !== "pending") {
      return resultForPersistedApproval(approval, () => this.waitForDecision(approval));
    }

    this.recordAuditMessage(approval, "approval.requested", `Approval requested: ${approval.summary}`, { approvalId: approval.id }, now);
    this.logger.info({
      source: "approval",
      eventName: "approval.requested",
      message: "Copilot permission request is waiting for user approval",
      correlationId: context.correlationId,
      metadata: { approvalId: approval.id, sessionId: approval.sessionId, taskId: approval.taskId, actionType: approval.actionType }
    });
    this.onApprovalRequested?.(approval);
    return this.waitForDecision(approval);
  }

  private waitForDecision(approval: ApprovalRecord): Promise<PermissionRequestResult> {
    if (approval.status !== "pending") {
      return Promise.resolve(permissionResultForStatus(approval));
    }
    return new Promise<PermissionRequestResult>((resolve) => {
      const waiters = this.decisionWaiters.get(approval.id) ?? new Set<Waiter>();
      waiters.add(resolve);
      this.decisionWaiters.set(approval.id, waiters);
    });
  }

  private waitForPermissionEvent(key: string): Promise<PermissionRequestedData | null> {
    const existing = this.permissionEvents.get(key);
    if (existing) {
      this.permissionEvents.delete(key);
      return Promise.resolve(existing);
    }
    if (this.permissionEventWaitMs <= 0) {
      return Promise.resolve(null);
    }
    return new Promise<PermissionRequestedData | null>((resolve) => {
      const waiters = this.eventWaiters.get(key) ?? new Set<EventWaiter>();
      const waiter: EventWaiter = (data) => {
        clearTimeout(timer);
        resolve(data);
      };
      const timer = setTimeout(() => {
        const current = this.eventWaiters.get(key);
        current?.delete(waiter);
        if (current?.size === 0) {
          this.eventWaiters.delete(key);
        }
        resolve(null);
      }, this.permissionEventWaitMs);
      waiters.add(waiter);
      this.eventWaiters.set(key, waiters);
    });
  }

  private resolveDecisionWaiters(approvalId: string, result: PermissionRequestResult): boolean {
    const waiters = this.decisionWaiters.get(approvalId);
    if (!waiters || waiters.size === 0) {
      return false;
    }
    this.decisionWaiters.delete(approvalId);
    for (const waiter of waiters) {
      waiter(result);
    }
    return true;
  }

  private getRequired(approvalId: string): ApprovalRecord {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          session_id AS sessionId,
          task_id AS taskId,
          run_id AS runId,
          request_id AS requestId,
          tool_call_id AS toolCallId,
          action_type AS actionType,
          summary,
          risk_level AS riskLevel,
          status,
          request_json AS requestJson,
          response_json AS responseJson,
          resolution_reason AS resolutionReason,
          metadata_json AS metadataJson,
          requested_at AS requestedAt,
          resolved_at AS resolvedAt
        FROM approvals
        WHERE id = ?
        LIMIT 1
      `
      )
      .get(approvalId) as ApprovalRow | undefined;
    if (!row) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    return mapApprovalRow(row);
  }

  private getBySessionRequestId(sessionId: string, requestId: string): ApprovalRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          session_id AS sessionId,
          task_id AS taskId,
          run_id AS runId,
          request_id AS requestId,
          tool_call_id AS toolCallId,
          action_type AS actionType,
          summary,
          risk_level AS riskLevel,
          status,
          request_json AS requestJson,
          response_json AS responseJson,
          resolution_reason AS resolutionReason,
          metadata_json AS metadataJson,
          requested_at AS requestedAt,
          resolved_at AS resolvedAt
        FROM approvals
        WHERE session_id = ? AND request_id = ?
        LIMIT 1
      `
      )
      .get(sessionId, requestId) as ApprovalRow | undefined;
    return row ? mapApprovalRow(row) : null;
  }

  private recordAuditMessage(approval: ApprovalRecord, eventType: string, content: string, metadata: unknown, timestamp: string): void {
    runTransaction(this.db, () => {
      if (approval.sessionId) {
        this.db
          .prepare(
            `
            INSERT INTO session_events (id, session_id, event_type, content, metadata_json, created_at)
            VALUES (@id, @sessionId, @eventType, @content, @metadataJson, @createdAt)
          `
          )
          .run({
            id: `session-event-${crypto.randomUUID()}`,
            sessionId: approval.sessionId,
            eventType,
            content,
            metadataJson: toJson(metadata),
            createdAt: timestamp
          });
        this.db.prepare("UPDATE sessions SET last_event_at = ? WHERE id = ?").run(timestamp, approval.sessionId);
      }
      if (approval.runId) {
        const current =
          (this.db
            .prepare("SELECT last_sequence_number AS lastSequenceNumber FROM execution_runs WHERE id = ?")
            .get(approval.runId) as { lastSequenceNumber: number } | undefined)?.lastSequenceNumber ?? 0;
        const sequenceNumber = current + 1;
        this.db.prepare("UPDATE execution_runs SET last_sequence_number = ? WHERE id = ?").run(sequenceNumber, approval.runId);
        this.db
          .prepare(
            `
            INSERT INTO run_messages (
              id, run_id, sequence_number, author_type, content_type, content, metadata_json, created_at
            ) VALUES (
              @id, @runId, @sequenceNumber, 'system', @contentType, @content, @metadataJson, @createdAt
            )
          `
          )
          .run({
            id: `run-message-${crypto.randomUUID()}`,
            runId: approval.runId,
            sequenceNumber,
            contentType: eventType,
            content,
            metadataJson: toJson(metadata),
            createdAt: timestamp
          });
      }
    });
  }
}

function resultForPersistedApproval(
  approval: ApprovalRecord,
  waitForPending: () => Promise<PermissionRequestResult>
): PermissionRequestResult | Promise<PermissionRequestResult> {
  return approval.status === "pending" ? waitForPending() : permissionResultForStatus(approval);
}

function permissionResultForStatus(approval: ApprovalRecord): PermissionRequestResult {
  if (approval.status === "approved") {
    return { kind: "approve-once" };
  }
  if (approval.status === "denied") {
    return { kind: "reject", feedback: approval.resolutionReason ?? "Denied by user" };
  }
  return { kind: "user-not-available" };
}

function permissionResultForDecision(decision: "approve" | "deny", feedback: string | null): PermissionRequestResult {
  return decision === "approve" ? { kind: "approve-once" } : { kind: "reject", feedback: feedback ?? "Denied by user" };
}

function requestKey(sessionId: string, request: unknown): string {
  const record = request && typeof request === "object" ? (request as Record<string, unknown>) : {};
  const toolCallId = stringOrNull(record.toolCallId);
  if (toolCallId) {
    return `${sessionId}:tool:${toolCallId}`;
  }
  const fingerprint = toJson({
    kind: record.kind,
    fileName: record.fileName,
    fullCommandText: record.fullCommandText,
    path: record.path,
    url: record.url,
    toolName: record.toolName,
    serverName: record.serverName,
    intention: record.intention
  });
  return `${sessionId}:fingerprint:${crypto.createHash("sha256").update(fingerprint).digest("hex")}`;
}

function summarizePermissionRequest(request: unknown): string {
  const record = request && typeof request === "object" ? (request as Record<string, unknown>) : {};
  const kind = stringOrNull(record.kind) ?? "unknown";
  if (kind === "shell") {
    return truncate(`Shell command: ${stringOrNull(record.fullCommandText) ?? stringOrNull(record.intention) ?? "requested command"}`, 500);
  }
  if (kind === "write") {
    return truncate(`File write: ${stringOrNull(record.fileName) ?? stringOrNull(record.intention) ?? "requested write"}`, 500);
  }
  if (kind === "read") {
    return truncate(`File read: ${stringOrNull(record.path) ?? stringOrNull(record.intention) ?? "requested read"}`, 500);
  }
  if (kind === "url") {
    return truncate(`URL access: ${stringOrNull(record.url) ?? stringOrNull(record.intention) ?? "requested URL"}`, 500);
  }
  if (kind === "mcp") {
    return truncate(`MCP tool: ${stringOrNull(record.serverName) ?? "server"} / ${stringOrNull(record.toolName) ?? "tool"}`, 500);
  }
  if (kind === "custom-tool") {
    return truncate(`Custom tool: ${stringOrNull(record.toolName) ?? stringOrNull(record.toolDescription) ?? "tool"}`, 500);
  }
  if (kind === "memory") {
    return truncate(`Memory action: ${stringOrNull(record.action) ?? stringOrNull(record.subject) ?? "memory request"}`, 500);
  }
  if (kind === "hook") {
    return truncate(`Hook confirmation: ${stringOrNull(record.toolName) ?? stringOrNull(record.hookMessage) ?? "hook request"}`, 500);
  }
  return truncate(`Permission requested: ${kind}`, 500);
}

function riskForPermissionRequest(request: unknown): ApprovalRiskLevel {
  const record = request && typeof request === "object" ? (request as Record<string, unknown>) : {};
  const kind = stringOrNull(record.kind);
  if (kind === "shell" || kind === "write") {
    return "high";
  }
  if (kind === "mcp" || kind === "custom-tool" || kind === "memory" || kind === "hook") {
    return "medium";
  }
  return "low";
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  const redacted = redactValue(value);
  const json = JSON.stringify(redacted);
  if (json.length <= 16000) {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed };
  }
  return { truncated: true, preview: json.slice(0, 16000) };
}

function mapApprovalRow(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    taskId: row.taskId,
    runId: row.runId,
    requestId: row.requestId,
    toolCallId: row.toolCallId,
    actionType: row.actionType,
    summary: row.summary,
    riskLevel: parseRisk(row.riskLevel),
    status: parseStatus(row.status),
    request: parseJsonObject(row.requestJson),
    response: row.responseJson ? parseJsonObject(row.responseJson) : null,
    resolutionReason: row.resolutionReason,
    metadata: parseJsonObject(row.metadataJson),
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt
  };
}

function parseRisk(value: string): ApprovalRiskLevel {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function parseStatus(value: string): ApprovalStatus {
  return ["pending", "approved", "denied", "cancelled", "expired"].includes(value) ? (value as ApprovalStatus) : "pending";
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
