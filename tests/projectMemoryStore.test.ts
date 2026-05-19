import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/main/db/migrations";
import { seedDefaults } from "../src/main/db/schema";
import { JsonlLogger } from "../src/main/logging/logger";
import { ProjectMemoryStore } from "../src/main/memory/projectMemoryStore";
import { getLelioPaths } from "../src/main/paths";
import { ProjectStore } from "../src/main/projects/projectStore";
import { TaskStore } from "../src/main/tasks/taskStore";

describe("ProjectMemoryStore", () => {
  it("detects instructions, manages approved skills, mounts them, and stores summaries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-memory-store-"));
    const projectPath = path.join(root, "memory-demo");
    fs.mkdirSync(path.join(projectPath, ".github", "instructions"), { recursive: true });
    fs.mkdirSync(path.join(projectPath, ".github", "skills", "repo-skill"), { recursive: true });
    fs.writeFileSync(path.join(projectPath, "AGENTS.md"), "Use repo guidance.", "utf8");
    fs.writeFileSync(path.join(projectPath, ".github", "instructions", "tests.instructions.md"), "Run tests.", "utf8");
    fs.writeFileSync(path.join(projectPath, ".github", "skills", "repo-skill", "SKILL.md"), "# Repo skill", "utf8");

    const db = new DatabaseSync(path.join(root, "memory.sqlite"));
    runMigrations(db);
    seedDefaults(db);

    const logger = new JsonlLogger(path.join(root, "logs"), "debug", 14);
    const projectStore = new ProjectStore(db, logger);
    const taskStore = new TaskStore(db, logger);
    const memoryStore = new ProjectMemoryStore(db, logger, { ...getLelioPaths(), appDataRoot: root });
    const project = projectStore.add({ path: projectPath, name: "Memory Demo", testCommand: "npm test" }, "project-add");
    const task = taskStore.create(
      {
        projectId: project.id,
        title: "Remember context",
        assigneeAgentId: "agent-software-engineer"
      },
      "task-create"
    );

    const memory = memoryStore.refreshProjectMemory(project.id, "memory-refresh");
    expect(memory.detectedInstructionFiles.map((file) => file.path)).toEqual([
      ".github/instructions/tests.instructions.md",
      ".github/skills/repo-skill/SKILL.md",
      "AGENTS.md"
    ]);
    expect(memory.contextCapsule).toContain("Memory Demo");

    const skill = memoryStore.createSkill(
      {
        name: "Review Checklist",
        description: "Review before handoff",
        content: "# Review Checklist\nConfirm tests pass."
      },
      "skill-create"
    );
    const attached = memoryStore.attachSkillToProject(
      { projectId: project.id, skillId: skill.id, mountApproved: true },
      "skill-attach"
    );
    expect(attached.attachedSkills).toMatchObject([{ name: "Review Checklist", mountApproved: true }]);
    expect(memoryStore.getTaskMemory(task.id).mountableSkills.map((candidate) => candidate.name)).toEqual(["Review Checklist"]);

    db.prepare(
      `
      INSERT INTO sessions (
        id, task_id, project_id, agent_id, provider_type, model, external_session_id,
        cwd, status, started_at, ended_at, last_event_at
      ) VALUES (
        'session-memory', @taskId, @projectId, 'agent-software-engineer', 'copilot', NULL, 'session-memory',
        @cwd, 'idle', '2026-05-19T00:00:00.000Z', NULL, '2026-05-19T00:01:00.000Z'
      )
    `
    ).run({ taskId: task.id, projectId: project.id, cwd: project.path });
    db.prepare(
      `
      INSERT INTO execution_runs (
        id, task_id, session_id, attempt_number, worktree_path, status,
        started_at, ended_at, exit_reason, last_sequence_number
      ) VALUES (
        'run-memory', @taskId, 'session-memory', 1, NULL, 'idle',
        '2026-05-19T00:00:00.000Z', NULL, NULL, 0
      )
    `
    ).run({ taskId: task.id });

    const mounts = memoryStore.mountSkillsForRun({
      runId: "run-memory",
      projectId: project.id,
      agentId: "agent-software-engineer",
      providerType: "copilot",
      cwd: project.path,
      correlationId: "skill-mount"
    });
    expect(mounts).toHaveLength(1);
    expect(fs.readFileSync(path.join(project.path, ".github", "skills", "review-checklist", "SKILL.md"), "utf8")).toContain(
      "Confirm tests pass."
    );
    expect(memoryStore.listRunSkillMounts("run-memory")).toMatchObject([{ skillName: "Review Checklist" }]);

    const summary = memoryStore.summarizeSession("session-memory", "summary-create");
    expect(summary.summary).toContain("Remember context");
    expect(memoryStore.getProjectMemory(project.id).sessionSummaries[0].id).toBe(summary.id);
  });
});
