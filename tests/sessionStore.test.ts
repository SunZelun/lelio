import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ResumeSessionConfig, SessionConfig, SessionEvent } from "@github/copilot-sdk";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/main/db/migrations";
import { seedDefaults } from "../src/main/db/schema";
import { JsonlLogger } from "../src/main/logging/logger";
import { ProjectMemoryStore } from "../src/main/memory/projectMemoryStore";
import { getLelioPaths } from "../src/main/paths";
import { ProjectStore } from "../src/main/projects/projectStore";
import type { GitCommandExecutor } from "../src/main/projects/gitStatus";
import { CopilotSdkAdapter, type CopilotSdkClient, type CopilotSdkSessionHandle } from "../src/main/runtime/copilotSdkAdapter";
import { RuntimeRegistry } from "../src/main/runtime/runtimeRegistry";
import { SessionStore } from "../src/main/sessions/sessionStore";
import { buildDeterministicSessionId } from "../src/main/sessions/sessionIds";
import { SettingsStore } from "../src/main/settings/settingsStore";
import { TaskStore } from "../src/main/tasks/taskStore";

describe("SessionStore", () => {
  it("starts, disconnects, and resumes deterministic Copilot sessions with separate runs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-session-store-"));
    const projectPath = path.join(root, "session-demo");
    fs.mkdirSync(projectPath);
    const db = new DatabaseSync(path.join(root, "sessions.sqlite"));
    runMigrations(db);
    seedDefaults(db);

    const logger = new JsonlLogger(path.join(root, "logs"), "debug", 14);
    const projectStore = new ProjectStore(db, logger);
    const taskStore = new TaskStore(db, logger);
    const runtimeRegistry = new RuntimeRegistry(db, logger);
    const settingsStore = new SettingsStore({ ...getLelioPaths(), appDataRoot: root, settingsPath: path.join(root, "settings.json") });
    const fakeClient = new FakeCopilotClient();
    const gitExecutor: GitCommandExecutor = async (command, args) => ({
      command,
      args,
      stdout: "## main\n M src/app.ts\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      durationMs: 2
    });
    const adapter = new CopilotSdkAdapter(logger, runtimeRegistry, () => settingsStore.get(), () => fakeClient);
    const memoryStore = new ProjectMemoryStore(db, logger, { ...getLelioPaths(), appDataRoot: root });
    const sessionStore = new SessionStore(db, logger, taskStore, adapter, memoryStore, undefined, gitExecutor);

    const project = projectStore.add({ path: projectPath, name: "Session Demo" }, "project-add");
    const task = taskStore.create(
      {
        projectId: project.id,
        title: "Wire Copilot SDK",
        assigneeAgentId: "agent-software-engineer"
      },
      "task-create"
    );
    const expectedSessionId = buildDeterministicSessionId({
      projectSlug: project.slug,
      taskId: task.id,
      agentSlug: "software-engineer"
    });
    const skill = memoryStore.createSkill(
      {
        name: "Test Skill",
        content: "# Test Skill\nUse this skill for test runs."
      },
      "skill-create"
    );
    memoryStore.attachSkillToProject({ projectId: project.id, skillId: skill.id, mountApproved: true }, "skill-attach");

    const started = await sessionStore.startTaskSession(task.id, "session-start");
    expect(started.session.id).toBe(expectedSessionId);
    expect(started.session.status).toBe("idle");
    expect(started.session.runs).toHaveLength(1);
    expect(started.session.runs[0].attemptNumber).toBe(1);
    expect(started.session.runs[0].mountedSkills.map((mount) => mount.skillName)).toEqual(["Test Skill"]);
    expect(fs.existsSync(path.join(project.path, ".github", "skills", "test-skill", "SKILL.md"))).toBe(true);
    expect(started.session.runs[0].lastSequenceNumber).toBeGreaterThanOrEqual(2);
    expect(fakeClient.createdSessionIds).toEqual([expectedSessionId]);

    const disconnected = await sessionStore.disconnectTaskSession(task.id, "session-disconnect");
    expect(disconnected.session.status).toBe("disconnected");
    expect(fakeClient.disconnects).toBe(1);

    const resumed = await sessionStore.resumeTaskSession(task.id, "session-resume");
    expect(resumed.session.id).toBe(expectedSessionId);
    expect(resumed.session.status).toBe("idle");
    expect(resumed.session.runs).toHaveLength(2);
    expect(resumed.session.runs.map((run) => run.attemptNumber)).toEqual([2, 1]);
    expect(fakeClient.resumedSessionIds).toEqual([expectedSessionId]);

    const detail = await sessionStore.getDetail({ id: expectedSessionId, includeGitSummary: true });
    expect(detail.messages.map((message) => message.content)).toEqual(["Session created", "session.idle", "Session resumed", "session.idle"]);
    expect(detail.changedFiles).toMatchObject({ status: "dirty", totalCount: 1 });
    expect(detail.events.some((event) => event.eventType === "session.resumed")).toBe(true);

    const cursors = Object.fromEntries(detail.messages.map((message) => [message.runId, message.sequenceNumber]));
    await expect(sessionStore.getDetail({ id: expectedSessionId, sinceSequenceNumbers: cursors })).resolves.toMatchObject({
      messages: []
    });

    const aborted = await sessionStore.abortSession(expectedSessionId, "session-abort");
    expect(aborted.session.status).toBe("aborted");
    expect(aborted.session.runs[0]).toMatchObject({ attemptNumber: 2, status: "aborted", exitReason: "aborted" });
    expect(fakeClient.aborts).toBe(1);

    const reloadedStore = new SessionStore(db, logger, taskStore, adapter, memoryStore, undefined, gitExecutor);
    expect(reloadedStore.list().find((session) => session.id === expectedSessionId)?.runs).toHaveLength(2);
  });
});

class FakeCopilotClient implements CopilotSdkClient {
  readonly createdSessionIds: string[] = [];
  readonly resumedSessionIds: string[] = [];
  disconnects = 0;
  aborts = 0;

  async createSession(config: SessionConfig): Promise<CopilotSdkSessionHandle> {
    const sessionId = config.sessionId ?? "generated-session";
    this.createdSessionIds.push(sessionId);
    config.onEvent?.(sessionEvent("assistant.message", { content: "Session created" }));
    config.onEvent?.(sessionEvent("session.idle", { idleDurationMs: 0 }));
    return this.handle(sessionId);
  }

  async resumeSession(sessionId: string, config: ResumeSessionConfig): Promise<CopilotSdkSessionHandle> {
    this.resumedSessionIds.push(sessionId);
    config.onEvent?.(sessionEvent("assistant.message", { content: "Session resumed" }));
    config.onEvent?.(sessionEvent("session.idle", { idleDurationMs: 0 }));
    return this.handle(sessionId);
  }

  async stop(): Promise<Error[]> {
    return [];
  }

  private handle(sessionId: string): CopilotSdkSessionHandle {
    return {
      sessionId,
      on: () => () => undefined,
      abort: async () => {
        this.aborts += 1;
      },
      disconnect: async () => {
        this.disconnects += 1;
      }
    };
  }
}

function sessionEvent(type: string, data: Record<string, unknown>): SessionEvent {
  return { type, data } as unknown as SessionEvent;
}
