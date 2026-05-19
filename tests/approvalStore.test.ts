import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PermissionRequest, SessionEvent } from "@github/copilot-sdk";
import { describe, expect, it } from "vitest";
import { ApprovalStore } from "../src/main/approvals/approvalStore";
import { runMigrations } from "../src/main/db/migrations";
import { seedDefaults } from "../src/main/db/schema";
import { JsonlLogger } from "../src/main/logging/logger";

describe("ApprovalStore", () => {
  it("blocks permission requests until they are approved", async () => {
    const { store } = createStore();
    const handler = store.createPermissionHandler(context());
    const resultPromise = handler(shellRequest("npm test", "tool-1"), { sessionId: "session-approval" });

    const pending = await waitForPending(store);
    expect(pending.summary).toContain("npm test");
    expect(pending.status).toBe("pending");

    const decision = store.decide({ approvalId: pending.id, decision: "approve" }, "approval-decision");
    await expect(resultPromise).resolves.toEqual({ kind: "approve-once" });
    expect(decision.approval.status).toBe("approved");
    expect(decision.resolvedLiveRequest).toBe(true);
  });

  it("persists denial feedback and reports it to the run timeline", async () => {
    const { db, store } = createStore();
    const handler = store.createPermissionHandler(context());
    const resultPromise = handler(shellRequest("rm -rf dist", "tool-2"), { sessionId: "session-approval" });

    const pending = await waitForPending(store);
    store.decide({ approvalId: pending.id, decision: "deny", feedback: "Too destructive" }, "approval-decision");

    await expect(resultPromise).resolves.toEqual({ kind: "reject", feedback: "Too destructive" });
    expect(store.list({ status: "denied" })[0]).toMatchObject({ resolutionReason: "Too destructive" });
    expect(
      db.prepare("SELECT content FROM run_messages WHERE content_type = 'approval.denied' ORDER BY sequence_number DESC LIMIT 1").get()
    ).toMatchObject({ content: expect.stringContaining("Denied") });
  });

  it("cancels pending approvals when the session ends", async () => {
    const { store } = createStore();
    const handler = store.createPermissionHandler(context());
    const resultPromise = handler(writeRequest("src/app.ts", "tool-3"), { sessionId: "session-approval" });

    const pending = await waitForPending(store);
    const cancelled = store.cancelPendingForSession("session-approval", "session_aborted", "abort");

    expect(cancelled.map((approval) => approval.id)).toContain(pending.id);
    await expect(resultPromise).resolves.toEqual({ kind: "user-not-available" });
    expect(store.list({ status: "cancelled" })[0]).toMatchObject({ id: pending.id, resolutionReason: "session_aborted" });
  });

  it("enriches approvals with SDK permission event request ids", async () => {
    const { store } = createStore();
    const request = shellRequest("npm run build", "tool-4");
    store.recordPermissionEvent("session-approval", permissionRequestedEvent("permission-request-4", request));

    const handler = store.createPermissionHandler(context());
    const resultPromise = handler(request, { sessionId: "session-approval" });
    const pending = await waitForPending(store);

    expect(pending.requestId).toBe("permission-request-4");
    expect(pending.request.permissionRequest).toMatchObject({ fullCommandText: "npm run build" });
    store.decide({ approvalId: pending.id, decision: "approve" }, "approval-decision");
    await expect(resultPromise).resolves.toEqual({ kind: "approve-once" });
  });
});

function createStore(): { db: DatabaseSync; store: ApprovalStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-approval-store-"));
  const db = new DatabaseSync(path.join(root, "approvals.sqlite"));
  runMigrations(db);
  seedDefaults(db);
  seedSession(db);
  return {
    db,
    store: new ApprovalStore(db, new JsonlLogger(path.join(root, "logs"), "debug", 14), 0)
  };
}

function seedSession(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO projects (
      id, name, slug, path, default_branch, package_manager, test_command, build_command, created_at, updated_at
    ) VALUES (
      'project-approval', 'Approval Project', 'approval-project', '/tmp/approval-project', 'main', null, null, null, @now, @now
    )
  `
  ).run({ now });
  db.prepare(
    `
    INSERT INTO tasks (
      id, project_id, title, description, status, priority, assignee_agent_id, due_at, branch, worktree_path, created_at, updated_at
    ) VALUES (
      'task-approval', 'project-approval', 'Approval task', null, 'in-progress', 'high', 'agent-software-engineer', null, null, null, @now, @now
    )
  `
  ).run({ now });
  db.prepare(
    `
    INSERT INTO sessions (
      id, task_id, project_id, agent_id, provider_type, model, external_session_id, cwd, status, started_at, ended_at, last_event_at
    ) VALUES (
      'session-approval', 'task-approval', 'project-approval', 'agent-software-engineer', 'copilot', null, 'session-approval', '/tmp/approval-project', 'running', @now, null, @now
    )
  `
  ).run({ now });
  db.prepare(
    `
    INSERT INTO execution_runs (
      id, task_id, session_id, attempt_number, worktree_path, status, started_at, ended_at, exit_reason, last_sequence_number
    ) VALUES (
      'run-approval', 'task-approval', 'session-approval', 1, null, 'running', @now, null, null, 0
    )
  `
  ).run({ now });
}

function context() {
  return {
    sessionId: "session-approval",
    taskId: "task-approval",
    runId: "run-approval",
    correlationId: "approval-test"
  };
}

function shellRequest(command: string, toolCallId: string): PermissionRequest & Record<string, unknown> {
  return {
    kind: "shell",
    toolCallId,
    fullCommandText: command,
    intention: "Run command",
    commands: [{ identifier: command.split(/\s+/)[0], readOnly: false }],
    possiblePaths: [],
    possibleUrls: [],
    hasWriteFileRedirection: false,
    canOfferSessionApproval: true
  } as PermissionRequest & Record<string, unknown>;
}

function writeRequest(fileName: string, toolCallId: string): PermissionRequest & Record<string, unknown> {
  return {
    kind: "write",
    toolCallId,
    fileName,
    intention: "Edit file",
    diff: "--- a/src/app.ts\n+++ b/src/app.ts\n"
  } as PermissionRequest & Record<string, unknown>;
}

function permissionRequestedEvent(requestId: string, permissionRequest: Record<string, unknown>): SessionEvent {
  return {
    id: `event-${requestId}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    type: "permission.requested",
    data: {
      requestId,
      permissionRequest
    }
  } as unknown as SessionEvent;
}

async function waitForPending(store: ApprovalStore) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pending = store.list({ status: "pending" })[0];
    if (pending) {
      return pending;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for pending approval");
}
