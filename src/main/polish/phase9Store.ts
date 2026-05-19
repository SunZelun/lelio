import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  BackupCreateInput,
  BackupManifest,
  BackupRestoreInput,
  BackupRestoreResult,
  CleanupCandidate,
  CleanupExecuteInput,
  CleanupExecuteResult,
  CleanupPreview,
  LocalBackup,
  OnboardingSampleProjectResult,
  Project,
  UpdateStrategy
} from "../../shared/schemas";
import { BackupManifestSchema } from "../../shared/schemas";
import type { SqliteDatabase } from "../db/sqlite";
import { mapProjectRow, type ProjectRow } from "../db/schema";
import { migrations } from "../db/migrations";
import type { JsonlLogger } from "../logging/logger";
import { redactString, redactValue } from "../logging/redaction";
import type { LelioPaths } from "../paths";
import type { ProjectStore } from "../projects/projectStore";
import type { StoredAppSettings, SettingsStore } from "../settings/settingsStore";

type ShortcutStatusProvider = () => UpdateStrategy["globalQuickOpen"];

const BACKUP_MANIFEST_FILE = "backup.json";
const BACKUP_DATABASE_FILE = "lelio.sqlite";
const BACKUP_SETTINGS_FILE = "settings.json";
const BACKUP_LOGS_DIRECTORY = "logs";
const PENDING_RESTORE_FILE = "restore-pending.json";
const CLEANUP_STATUSES = new Set(["done", "cancelled"]);

export class Phase9Store {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly paths: LelioPaths,
    private readonly settingsStore: SettingsStore,
    private readonly projectStore: ProjectStore,
    private readonly logger: JsonlLogger,
    private readonly appVersion: string,
    private readonly shortcutStatus: ShortcutStatusProvider
  ) {}

  listBackups(): LocalBackup[] {
    const root = this.defaultBackupRoot();
    if (!fs.existsSync(root)) {
      return [];
    }

    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .map((backupPath) => this.safeReadBackup(backupPath))
      .filter((backup): backup is LocalBackup => Boolean(backup))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  createBackup(input: BackupCreateInput = {}, correlationId: string): LocalBackup {
    const includeSecrets = input?.includeSecrets === true;
    const backupRoot = input?.destination ? path.resolve(input.destination) : this.defaultBackupRoot();
    fs.mkdirSync(backupRoot, { recursive: true });

    const createdAt = new Date().toISOString();
    const backupPath = path.join(backupRoot, `lelio-backup-${safeTimestamp(createdAt)}-${crypto.randomUUID().slice(0, 8)}`);
    fs.mkdirSync(backupPath, { recursive: true });

    const databaseFile = path.join(backupPath, BACKUP_DATABASE_FILE);
    this.db.exec(`VACUUM INTO ${sqlString(databaseFile)}`);
    const integrityCheck = verifyDatabase(databaseFile);
    if (integrityCheck !== "ok") {
      throw new Error(`Backup database integrity check failed: ${integrityCheck}`);
    }

    const settingsFile = path.join(backupPath, BACKUP_SETTINGS_FILE);
    writeJson(settingsFile, backupSettings(this.settingsStore.getInternal(), includeSecrets), false);

    const logsDirectory = path.join(backupPath, BACKUP_LOGS_DIRECTORY);
    copyRecentRedactedLogs(this.paths.logsRoot, logsDirectory);

    const schemaVersion = this.currentSchemaVersion();
    const manifest: BackupManifest = {
      appVersion: this.appVersion,
      schemaVersion,
      createdAt,
      databaseFile: BACKUP_DATABASE_FILE,
      settingsFile: BACKUP_SETTINGS_FILE,
      logsDirectory: fs.existsSync(logsDirectory) ? BACKUP_LOGS_DIRECTORY : null,
      secretsIncluded: includeSecrets,
      integrityCheck
    };
    writeJson(path.join(backupPath, BACKUP_MANIFEST_FILE), manifest, false);

    this.logger.info({
      source: "backup",
      eventName: "backup.create",
      message: "Local backup created",
      correlationId,
      metadata: {
        backupPath,
        schemaVersion,
        secretsIncluded: includeSecrets,
        sizeBytes: directorySize(backupPath)
      }
    });

    return this.backupFromManifest(backupPath, manifest);
  }

  scheduleRestore(input: BackupRestoreInput, correlationId: string): BackupRestoreResult {
    const backupPath = path.resolve(input.backupPath);
    const manifest = this.validateBackup(backupPath);
    const pendingPath = pendingRestorePath(this.paths);
    writeJson(pendingPath, {
      backupPath,
      requestedAt: new Date().toISOString(),
      correlationId
    });

    this.logger.warn({
      source: "backup",
      eventName: "backup.restore.scheduled",
      message: "Backup restore scheduled for next launch",
      correlationId,
      metadata: { backupPath, schemaVersion: manifest.schemaVersion }
    });

    return {
      restorePending: true,
      restartRequired: true,
      backupPath,
      manifest,
      pendingRestorePath: pendingPath
    };
  }

  getUpdateStrategy(): UpdateStrategy {
    return {
      currentVersion: this.appVersion,
      mode: "manual",
      channel: "local",
      automaticChecksEnabled: false,
      feedUrl: null,
      notes: [
        "Phase 9 uses a local/manual update strategy stub only.",
        "No auto-updater module is imported and no network update checks run at startup.",
        "Packaged builds can be distributed manually until a signed update feed is configured."
      ],
      globalQuickOpen: this.shortcutStatus()
    };
  }

  createSampleProject(correlationId: string): OnboardingSampleProjectResult {
    const sampleRoot = path.join(this.paths.appDataRoot, "sample-project");
    const srcRoot = path.join(sampleRoot, "src");
    const createdFiles: string[] = [];

    fs.mkdirSync(srcRoot, { recursive: true });
    const files = [
      {
        path: path.join(sampleRoot, "README.md"),
        content: "# Lelio Sample Project\n\nA tiny local project for trying the task board, quick chat, reviews, and approvals without scanning real repositories.\n"
      },
      {
        path: path.join(sampleRoot, "package.json"),
        content: `${JSON.stringify({ name: "lelio-sample-project", private: true, scripts: { test: "node src/index.js", build: "node src/index.js" } }, null, 2)}\n`
      },
      {
        path: path.join(srcRoot, "index.js"),
        content: "console.log('Lelio sample project ready');\n"
      }
    ];

    for (const file of files) {
      if (!fs.existsSync(file.path)) {
        fs.writeFileSync(file.path, file.content, "utf8");
        createdFiles.push(file.path);
      }
    }

    const existingProject = this.findProjectByPath(sampleRoot);
    const project =
      existingProject ??
      this.projectStore.add(
        {
          path: sampleRoot,
          name: "Lelio Sample Project",
          packageManager: "npm",
          testCommand: "npm test",
          buildCommand: "npm run build"
        },
        correlationId
      );

    this.logger.info({
      source: "onboarding",
      eventName: "onboarding.sample_project",
      message: "Sample project is available",
      correlationId,
      metadata: { projectId: project.id, path: project.path, createdFileCount: createdFiles.length }
    });

    return {
      project,
      createdFiles,
      alreadyExisted: createdFiles.length === 0 && Boolean(existingProject)
    };
  }

  previewCleanup(): CleanupPreview {
    const generatedAt = new Date().toISOString();
    const candidates = this.cleanupCandidates();
    return {
      generatedAt,
      candidates,
      totalBytes: candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0),
      deletableBytes: candidates.filter((candidate) => candidate.safeToDelete).reduce((sum, candidate) => sum + candidate.sizeBytes, 0)
    };
  }

  executeCleanup(input: CleanupExecuteInput, correlationId: string): CleanupExecuteResult {
    const requestedTaskIds = new Set(input.taskIds);
    const candidates = this.cleanupCandidates().filter((candidate) => requestedTaskIds.has(candidate.taskId));
    if (candidates.length !== requestedTaskIds.size) {
      throw new Error("One or more cleanup tasks are no longer eligible.");
    }
    const unsafeCandidate = candidates.find((candidate) => !candidate.safeToDelete);
    if (unsafeCandidate) {
      throw new Error(`Cleanup refused for ${unsafeCandidate.path}: ${unsafeCandidate.reason ?? "unsafe candidate"}`);
    }

    const deletedAt = new Date().toISOString();
    for (const candidate of candidates) {
      const reassessed = this.assessWorktree(candidate);
      if (!reassessed.safeToDelete) {
        throw new Error(`Cleanup refused for ${candidate.path}: ${reassessed.reason ?? "unsafe candidate"}`);
      }
      fs.rmSync(candidate.path, { recursive: true, force: false });
    }

    const deletedBytes = candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0);
    this.logger.warn({
      source: "cleanup",
      eventName: "cleanup.execute",
      message: "Cleanup removed completed task worktrees",
      correlationId,
      metadata: { taskIds: input.taskIds, deletedBytes }
    });

    return {
      deletedAt,
      deletedCandidates: candidates,
      deletedBytes
    };
  }

  private safeReadBackup(backupPath: string): LocalBackup | null {
    try {
      const manifest = readManifest(backupPath);
      return this.backupFromManifest(backupPath, manifest);
    } catch {
      return null;
    }
  }

  private backupFromManifest(backupPath: string, manifest: BackupManifest): LocalBackup {
    return {
      backupPath,
      manifestPath: path.join(backupPath, BACKUP_MANIFEST_FILE),
      createdAt: manifest.createdAt,
      schemaVersion: manifest.schemaVersion,
      appVersion: manifest.appVersion,
      secretsIncluded: manifest.secretsIncluded,
      sizeBytes: directorySize(backupPath)
    };
  }

  private validateBackup(backupPath: string): BackupManifest {
    const manifest = readManifest(backupPath);
    if (manifest.schemaVersion > latestSchemaVersion()) {
      throw new Error(`Backup schema version ${manifest.schemaVersion} is newer than this app supports.`);
    }
    const databaseFile = path.join(backupPath, manifest.databaseFile);
    const integrityCheck = verifyDatabase(databaseFile);
    if (integrityCheck !== "ok") {
      throw new Error(`Backup database integrity check failed: ${integrityCheck}`);
    }
    return manifest;
  }

  private currentSchemaVersion(): number {
    return (
      (this.db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number }).version ?? 0
    );
  }

  private defaultBackupRoot(): string {
    return path.join(this.paths.appDataRoot, "backups");
  }

  private findProjectByPath(projectPath: string): Project | null {
    const row = this.db
      .prepare(
        `
        SELECT
          id, name, slug, path, default_branch AS defaultBranch,
          package_manager AS packageManager, test_command AS testCommand,
          build_command AS buildCommand, metadata_json AS metadataJson,
          git_branch AS gitBranch, git_dirty AS gitDirty, git_status AS gitStatus,
          git_changed_files_count AS gitChangedFilesCount,
          git_last_checked_at AS gitLastCheckedAt, last_activity_at AS lastActivityAt,
          created_at AS createdAt, updated_at AS updatedAt
        FROM projects
        WHERE path = ?
      `
      )
      .get(projectPath) as ProjectRow | undefined;
    return row ? mapProjectRow(row) : null;
  }

  private cleanupCandidates(): CleanupCandidate[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          t.id AS taskId, t.title AS taskTitle, t.status AS taskStatus,
          t.worktree_path AS worktreePath, COALESCE(t.updated_at, t.created_at) AS lastActivityAt,
          p.path AS projectPath
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.status IN ('done', 'cancelled') AND t.worktree_path IS NOT NULL
        ORDER BY COALESCE(t.updated_at, t.created_at) ASC
      `
      )
      .all() as Array<{
      taskId: string;
      taskTitle: string;
      taskStatus: "done" | "cancelled";
      worktreePath: string;
      lastActivityAt: string | null;
      projectPath: string | null;
    }>;

    return rows.map((row) =>
      this.assessWorktree({
        taskId: row.taskId,
        taskTitle: row.taskTitle,
        taskStatus: row.taskStatus,
        path: row.worktreePath,
        kind: "task-worktree",
        sizeBytes: 0,
        safeToDelete: false,
        reason: null,
        lastActivityAt: row.lastActivityAt
      }, row.projectPath)
    );
  }

  private assessWorktree(candidate: CleanupCandidate, projectPath?: string | null): CleanupCandidate {
    if (!CLEANUP_STATUSES.has(candidate.taskStatus)) {
      return { ...candidate, safeToDelete: false, reason: "Task is not completed or cancelled." };
    }
    if (!fs.existsSync(candidate.path)) {
      return { ...candidate, safeToDelete: false, reason: "Worktree path no longer exists." };
    }

    const lstat = fs.lstatSync(candidate.path);
    if (lstat.isSymbolicLink()) {
      return { ...candidate, safeToDelete: false, reason: "Cleanup refuses symlink roots." };
    }
    if (!lstat.isDirectory()) {
      return { ...candidate, safeToDelete: false, reason: "Cleanup only deletes task worktree directories." };
    }

    const rootReal = realpathOrNull(this.paths.worktreeRoot);
    const candidateReal = realpathOrNull(candidate.path);
    if (!rootReal || !candidateReal || !isInside(rootReal, candidateReal)) {
      return { ...candidate, safeToDelete: false, reason: "Path is outside the configured Lelio worktree root." };
    }

    if (projectPath) {
      const projectReal = realpathOrNull(projectPath);
      if (projectReal && (projectReal === candidateReal || isInside(projectReal, candidateReal))) {
        return { ...candidate, safeToDelete: false, reason: "Cleanup refuses to delete a registered project path." };
      }
    }

    const gitPath = findNestedGitPath(candidate.path);
    if (gitPath) {
      return { ...candidate, safeToDelete: false, reason: `Dry-run refused because ${path.relative(candidate.path, gitPath)} is present.` };
    }

    return {
      ...candidate,
      sizeBytes: directorySize(candidate.path),
      safeToDelete: true,
      reason: null
    };
  }
}

export function applyPendingRestore(paths: LelioPaths, logger?: JsonlLogger): void {
  const pendingPath = pendingRestorePath(paths);
  if (!fs.existsSync(pendingPath)) {
    return;
  }

  const pending = JSON.parse(fs.readFileSync(pendingPath, "utf8")) as { backupPath?: string; requestedAt?: string; correlationId?: string };
  if (!pending.backupPath) {
    throw new Error("Pending restore file is missing a backup path.");
  }
  const backupPath = path.resolve(pending.backupPath);
  const manifest = readManifest(backupPath);
  if (manifest.schemaVersion > latestSchemaVersion()) {
    throw new Error(`Pending restore schema version ${manifest.schemaVersion} is newer than this app supports.`);
  }
  const backupDatabase = path.join(backupPath, manifest.databaseFile);
  const integrityCheck = verifyDatabase(backupDatabase);
  if (integrityCheck !== "ok") {
    throw new Error(`Pending restore database integrity check failed: ${integrityCheck}`);
  }

  const safetySnapshotPath = path.join(paths.appDataRoot, "restore-snapshots", `pre-restore-${safeTimestamp(new Date().toISOString())}`);
  fs.mkdirSync(safetySnapshotPath, { recursive: true });
  for (const liveDatabaseFile of [paths.databasePath, ...databaseCompanionFiles(paths.databasePath)]) {
    if (fs.existsSync(liveDatabaseFile)) {
      fs.copyFileSync(liveDatabaseFile, path.join(safetySnapshotPath, path.basename(liveDatabaseFile)));
    }
  }
  if (fs.existsSync(paths.settingsPath)) {
    fs.copyFileSync(paths.settingsPath, path.join(safetySnapshotPath, BACKUP_SETTINGS_FILE));
  }

  for (const staleDatabaseFile of [paths.databasePath, ...databaseCompanionFiles(paths.databasePath)]) {
    fs.rmSync(staleDatabaseFile, { force: true });
  }
  fs.copyFileSync(backupDatabase, paths.databasePath);
  if (manifest.settingsFile) {
    fs.copyFileSync(path.join(backupPath, manifest.settingsFile), paths.settingsPath);
  }
  fs.rmSync(pendingPath, { force: true });

  logger?.warn({
    source: "backup",
    eventName: "backup.restore.applied",
    message: "Backup restore applied on startup",
    correlationId: pending.correlationId,
    metadata: { backupPath, requestedAt: pending.requestedAt, safetySnapshotPath }
  });
}

function backupSettings(settings: StoredAppSettings, includeSecrets: boolean): StoredAppSettings {
  if (includeSecrets) {
    return settings;
  }
  return {
    ...settings,
    openAiCompatibleApiKey: null,
    openAiCompatibleApiKeySet: false
  };
}

function readManifest(backupPath: string): BackupManifest {
  return BackupManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(backupPath, BACKUP_MANIFEST_FILE), "utf8")));
}

function pendingRestorePath(paths: LelioPaths): string {
  return path.join(paths.appDataRoot, PENDING_RESTORE_FILE);
}

function latestSchemaVersion(): number {
  return Math.max(0, ...migrations.map((migration) => migration.version));
}

function verifyDatabase(databasePath: string): "ok" | string {
  const backupDb = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return (backupDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  } finally {
    backupDb.close();
  }
}

function databaseCompanionFiles(databasePath: string): string[] {
  return [`${databasePath}-wal`, `${databasePath}-shm`];
}

function copyRecentRedactedLogs(sourceRoot: string, destinationRoot: string): void {
  if (!fs.existsSync(sourceRoot)) {
    return;
  }
  fs.mkdirSync(destinationRoot, { recursive: true });
  const files = fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(sourceRoot, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
    .slice(0, 5);

  for (const file of files) {
    const redacted = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => redactString(line))
      .join("\n");
    fs.writeFileSync(path.join(destinationRoot, path.basename(file)), redacted ? `${redacted}\n` : "", "utf8");
  }
}

function directorySize(root: string): number {
  if (!fs.existsSync(root)) {
    return 0;
  }
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) {
    return 0;
  }
  if (stat.isFile()) {
    return stat.size;
  }
  if (!stat.isDirectory()) {
    return 0;
  }
  return fs.readdirSync(root).reduce((sum, name) => sum + directorySize(path.join(root, name)), 0);
}

function findNestedGitPath(root: string): string | null {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.name === ".git") {
      return entryPath;
    }
    if (entry.isSymbolicLink()) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const nested = findNestedGitPath(entryPath);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function realpathOrNull(targetPath: string): string | null {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return null;
  }
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function writeJson(filePath: string, value: unknown, redact = true): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(redact ? redactValue(value) : value, null, 2)}\n`, "utf8");
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
