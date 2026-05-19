import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { LelioPaths } from "../src/main/paths";
import { runMigrations } from "../src/main/db/migrations";
import { seedDefaults } from "../src/main/db/schema";
import { JsonlLogger } from "../src/main/logging/logger";
import { Phase9Store, applyPendingRestore } from "../src/main/polish/phase9Store";
import { ProjectStore } from "../src/main/projects/projectStore";
import { SettingsStore } from "../src/main/settings/settingsStore";

describe("Phase9Store", () => {
  it("creates online-safe database backups with redacted settings", () => {
    const { db, paths, store } = createStore();
    const settingsStore = new SettingsStore(paths);
    settingsStore.update({
      openAiCompatibleBaseUrl: "https://llm.example.test/v1",
      openAiCompatibleApiKey: "sk-testsecret0123456789"
    });

    const backup = store.createBackup(undefined, "backup-test");
    const backupSettings = JSON.parse(fs.readFileSync(path.join(backup.backupPath, "settings.json"), "utf8")) as Record<string, unknown>;
    const backupDb = new DatabaseSync(path.join(backup.backupPath, "lelio.sqlite"), { readOnly: true });
    const integrityCheck = backupDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    backupDb.close();

    expect(backup.secretsIncluded).toBe(false);
    expect(backupSettings.openAiCompatibleApiKey).toBeNull();
    expect(backupSettings.openAiCompatibleApiKeySet).toBe(false);
    expect(integrityCheck.integrity_check).toBe("ok");
    db.close();
  });

  it("schedules restore and applies it before the database opens", () => {
    const { db, paths, store } = createStore();
    const backup = store.createBackup(undefined, "backup-test");
    seedProject(db, "project-after-backup", path.join(paths.appDataRoot, "after-backup"));

    const result = store.scheduleRestore({ backupPath: backup.backupPath }, "restore-test");
    db.close();
    applyPendingRestore(paths);

    const restored = new DatabaseSync(paths.databasePath);
    expect(result.restartRequired).toBe(true);
    expect(
      restored.prepare("SELECT COUNT(*) AS count FROM projects WHERE id = 'project-after-backup'").get()
    ).toMatchObject({ count: 0 });
    restored.close();
  });

  it("previews cleanup conservatively and deletes only safe task worktrees", () => {
    const { db, paths, store } = createStore();
    const projectPath = path.join(paths.appDataRoot, "source-project");
    fs.mkdirSync(projectPath, { recursive: true });
    const safePath = path.join(paths.worktreeRoot, "sample", "task-safe");
    const gitPath = path.join(paths.worktreeRoot, "sample", "task-git");
    fs.mkdirSync(safePath, { recursive: true });
    fs.writeFileSync(path.join(safePath, "output.txt"), "safe cleanup\n", "utf8");
    fs.mkdirSync(gitPath, { recursive: true });
    fs.writeFileSync(path.join(gitPath, ".git"), "gitdir: /tmp/lelio-worktree\n", "utf8");
    seedProject(db, "project-cleanup", projectPath);
    seedCleanupTask(db, "task-safe", "Safe cleanup", "project-cleanup", safePath);
    seedCleanupTask(db, "task-git", "Git cleanup", "project-cleanup", gitPath);

    const preview = store.previewCleanup();
    const safe = preview.candidates.find((candidate) => candidate.taskId === "task-safe");
    const refused = preview.candidates.find((candidate) => candidate.taskId === "task-git");
    expect(safe).toMatchObject({ safeToDelete: true });
    expect(refused).toMatchObject({ safeToDelete: false });

    const result = store.executeCleanup({ taskIds: ["task-safe"] }, "cleanup-test");
    expect(result.deletedCandidates).toHaveLength(1);
    expect(fs.existsSync(safePath)).toBe(false);
    expect(fs.existsSync(gitPath)).toBe(true);
    db.close();
  });

  it("creates and reuses the onboarding sample project explicitly", () => {
    const { db, store } = createStore();
    const created = store.createSampleProject("sample-test");
    const reused = store.createSampleProject("sample-test-2");

    expect(created.project.name).toBe("Lelio Sample Project");
    expect(created.createdFiles.length).toBeGreaterThan(0);
    expect(reused.project.id).toBe(created.project.id);
    expect(reused.alreadyExisted).toBe(true);
    db.close();
  });
});

function createStore(): { db: DatabaseSync; paths: LelioPaths; store: Phase9Store } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-phase9-"));
  const paths: LelioPaths = {
    appDataRoot: path.join(root, "Application Support", "Lelio"),
    databasePath: path.join(root, "Application Support", "Lelio", "lelio.sqlite"),
    settingsPath: path.join(root, "Application Support", "Lelio", "settings.json"),
    worktreeRoot: path.join(root, "Application Support", "Lelio", "worktrees"),
    logsRoot: path.join(root, "Logs", "Lelio"),
    desktopRoot: path.join(root, "Desktop")
  };
  fs.mkdirSync(paths.appDataRoot, { recursive: true });
  fs.mkdirSync(paths.worktreeRoot, { recursive: true });
  fs.mkdirSync(paths.logsRoot, { recursive: true });

  const db = new DatabaseSync(paths.databasePath);
  runMigrations(db);
  seedDefaults(db);
  const logger = new JsonlLogger(paths.logsRoot, "debug", 14);
  const settingsStore = new SettingsStore(paths);
  const projectStore = new ProjectStore(db, logger);
  const store = new Phase9Store(db, paths, settingsStore, projectStore, logger, "0.0-test", () => ({
    accelerator: "CommandOrControl+Shift+L",
    registered: true,
    reason: null
  }));
  return { db, paths, store };
}

function seedProject(db: DatabaseSync, id: string, projectPath: string): void {
  fs.mkdirSync(projectPath, { recursive: true });
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO projects (
      id, name, slug, path, default_branch, package_manager, test_command, build_command,
      metadata_json, git_status, git_changed_files_count, created_at, updated_at
    ) VALUES (
      @id, @name, @slug, @path, 'main', 'npm', null, null,
      '{}', 'unknown', 0, @now, @now
    )
  `
  ).run({
    id,
    name: id,
    slug: id,
    path: projectPath,
    now
  });
}

function seedCleanupTask(db: DatabaseSync, id: string, title: string, projectId: string, worktreePath: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO tasks (
      id, project_id, title, description, status, priority, assignee_agent_id, due_at, branch, worktree_path, created_at, updated_at
    ) VALUES (
      @id, @projectId, @title, null, 'done', 'medium', null, null, null, @worktreePath, @now, @now
    )
  `
  ).run({ id, projectId, title, worktreePath, now });
}
