import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/main/db/migrations";
import { seedDefaults } from "../src/main/db/schema";
import { JsonlLogger } from "../src/main/logging/logger";
import { ProjectStore } from "../src/main/projects/projectStore";
import { TaskStore } from "../src/main/tasks/taskStore";

describe("TaskStore", () => {
  it("creates, updates, reloads, joins, and deletes tasks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-task-store-"));
    const projectPath = path.join(root, "task-demo");
    fs.mkdirSync(projectPath);
    const dbPath = path.join(root, "tasks.sqlite");

    const db = new DatabaseSync(dbPath);
    runMigrations(db);
    seedDefaults(db);

    const logger = new JsonlLogger(path.join(root, "logs"), "debug", 14);
    const projectStore = new ProjectStore(db, logger);
    const taskStore = new TaskStore(db, logger);
    const project = projectStore.add({ path: projectPath, name: "Task Demo" }, "project-add");

    const created = taskStore.create(
      {
        projectId: project.id,
        title: "Build task board",
        priority: "high",
        assigneeAgentId: "agent-software-engineer",
        dueAt: "2026-06-01",
        branch: "lelio/task-board",
        worktreePath: path.join(root, "worktrees", "task-board")
      },
      "task-create"
    );

    expect(created.status).toBe("open");
    expect(created.projectName).toBe("Task Demo");
    expect(created.assigneeAgentName).toBe("Software Engineer");
    expect(created.changedFilesCount).toBe(0);

    const updated = taskStore.update(
      {
        id: created.id,
        status: "in-progress",
        priority: "urgent",
        description: "Phase 2 board foundation"
      },
      "task-update"
    );

    expect(updated.status).toBe("in-progress");
    expect(updated.priority).toBe("urgent");
    expect(updated.description).toBe("Phase 2 board foundation");

    db.prepare(
      `
      INSERT INTO sessions (
        id, task_id, project_id, agent_id, provider_type, model, external_session_id,
        cwd, status, started_at, ended_at, last_event_at
      ) VALUES (
        @id, @taskId, @projectId, @agentId, @providerType, @model, @externalSessionId,
        @cwd, @status, @startedAt, @endedAt, @lastEventAt
      )
    `
    ).run({
      id: "session-local-row",
      taskId: created.id,
      projectId: project.id,
      agentId: "agent-software-engineer",
      providerType: "copilot",
      model: null,
      externalSessionId: "lelio-task-demo-task-board-software-engineer",
      cwd: project.path,
      status: "idle",
      startedAt: "2026-06-01T10:00:00.000Z",
      endedAt: null,
      lastEventAt: "2026-06-01T10:05:00.000Z"
    });

    expect(taskStore.getRequired(created.id).sessionId).toBe("lelio-task-demo-task-board-software-engineer");
    expect(taskStore.list()).toHaveLength(1);

    db.close();

    const reloadedDb = new DatabaseSync(dbPath);
    runMigrations(reloadedDb);
    seedDefaults(reloadedDb);
    const reloadedStore = new TaskStore(reloadedDb, logger);
    const persisted = reloadedStore.getRequired(created.id);

    expect(persisted.status).toBe("in-progress");
    expect(persisted.projectId).toBe(project.id);
    expect(persisted.sessionStatus).toBe("idle");

    expect(reloadedStore.delete(created.id, "task-delete")).toEqual({ deleted: true, id: created.id });
    expect(reloadedStore.list()).toHaveLength(0);
    reloadedDb.close();
  });
});
