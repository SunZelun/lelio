import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Project, ProjectCreateInput, ProjectUpdateInput } from "../../shared/schemas";
import type { JsonlLogger } from "../logging/logger";
import type { SqliteDatabase } from "../db/sqlite";
import { mapProjectRow, type ProjectRow } from "../db/schema";
import { getGitSnapshot, type GitCommandExecutor } from "./gitStatus";

export class ProjectStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly logger: JsonlLogger,
    private readonly gitExecutor?: GitCommandExecutor
  ) {}

  list(): Project[] {
    return this.db
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
        ORDER BY COALESCE(last_activity_at, updated_at) DESC
      `
      )
      .all()
      .map((row) => mapProjectRow(row as ProjectRow));
  }

  add(input: ProjectCreateInput, correlationId: string): Project {
    const normalizedPath = normalizeProjectPath(input.path);
    assertDirectory(normalizedPath);

    const now = new Date().toISOString();
    const name = input.name ?? path.basename(normalizedPath);
    const slug = this.uniqueSlug(slugify(name));
    const id = `project-${crypto.randomUUID()}`;
    const packageManager = input.packageManager ?? detectPackageManager(normalizedPath);

    this.db
      .prepare(
        `
        INSERT INTO projects (
          id, name, slug, path, default_branch, package_manager, test_command, build_command,
          metadata_json, git_status, git_changed_files_count, last_activity_at, created_at, updated_at
        ) VALUES (
          @id, @name, @slug, @path, @defaultBranch, @packageManager, @testCommand, @buildCommand,
          @metadataJson, 'unknown', 0, @lastActivityAt, @createdAt, @updatedAt
        )
      `
      )
      .run({
        id,
        name,
        slug,
        path: normalizedPath,
        defaultBranch: null,
        packageManager,
        testCommand: input.testCommand ?? null,
        buildCommand: input.buildCommand ?? null,
        metadataJson: JSON.stringify({ addedFrom: "manual" }),
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now
      });

    this.logger.info({
      source: "project",
      eventName: "project.add",
      message: "Project registered",
      correlationId,
      metadata: { projectId: id, path: normalizedPath }
    });

    return this.getRequired(id);
  }

  update(input: ProjectUpdateInput, correlationId: string): Project {
    const current = this.getRequired(input.id);
    const now = new Date().toISOString();
    const nextName = input.name ?? current.name;
    const nextPackageManager = input.packageManager === undefined ? current.packageManager : input.packageManager;
    const nextTestCommand = input.testCommand === undefined ? current.testCommand : input.testCommand;
    const nextBuildCommand = input.buildCommand === undefined ? current.buildCommand : input.buildCommand;

    this.db
      .prepare(
        `
        UPDATE projects
        SET name = @name,
            package_manager = @packageManager,
            test_command = @testCommand,
            build_command = @buildCommand,
            last_activity_at = @updatedAt,
            updated_at = @updatedAt
        WHERE id = @id
      `
      )
      .run({
        id: input.id,
        name: nextName,
        packageManager: nextPackageManager,
        testCommand: nextTestCommand,
        buildCommand: nextBuildCommand,
        updatedAt: now
      });

    this.logger.info({
      source: "project",
      eventName: "project.update",
      message: "Project updated",
      correlationId,
      metadata: { projectId: input.id }
    });

    return this.getRequired(input.id);
  }

  remove(id: string, correlationId: string): { removed: true; id: string } {
    this.getRequired(id);
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    this.logger.info({
      source: "project",
      eventName: "project.remove",
      message: "Project removed",
      correlationId,
      metadata: { projectId: id }
    });
    return { removed: true, id };
  }

  async refreshGitStatus(id: string, correlationId: string): Promise<Project> {
    const project = this.getRequired(id);
    this.logger.info({
      source: "git",
      eventName: "git.status.start",
      message: "Refreshing project git status",
      correlationId,
      metadata: { projectId: id, path: project.path }
    });

    const snapshot = await getGitSnapshot(project.path, this.gitExecutor);
    const metadata = {
      ...project.metadata,
      gitStderrSummary: snapshot.stderrSummary
    };

    this.db
      .prepare(
        `
        UPDATE projects
        SET default_branch = COALESCE(default_branch, @branch),
            git_branch = @branch,
            git_dirty = @dirty,
            git_status = @status,
            git_changed_files_count = @changedFilesCount,
            git_last_checked_at = @checkedAt,
            last_activity_at = @checkedAt,
            metadata_json = @metadataJson,
            updated_at = @checkedAt
        WHERE id = @id
      `
      )
      .run({
        id,
        branch: snapshot.branch,
        dirty: snapshot.dirty === null ? null : snapshot.dirty ? 1 : 0,
        status: snapshot.status,
        changedFilesCount: snapshot.changedFilesCount,
        checkedAt: snapshot.checkedAt,
        metadataJson: JSON.stringify(metadata)
      });

    this.logger.info({
      source: "git",
      eventName: "git.status.complete",
      message: "Project git status refreshed",
      correlationId,
      metadata: {
        projectId: id,
        status: snapshot.status,
        branch: snapshot.branch,
        changedFilesCount: snapshot.changedFilesCount
      }
    });

    return this.getRequired(id);
  }

  getRequired(id: string): Project {
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
        WHERE id = ?
      `
      )
      .get(id) as ProjectRow | undefined;

    if (!row) {
      throw new Error(`Project not found: ${id}`);
    }

    return mapProjectRow(row);
  }

  private uniqueSlug(baseSlug: string): string {
    let slug = baseSlug || "project";
    let suffix = 2;
    while (this.slugExists(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    return slug;
  }

  private slugExists(slug: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM projects WHERE slug = ?").get(slug);
    return Boolean(row);
  }
}

export function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath.replace(/^~/, process.env.HOME ?? "~"));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function assertDirectory(projectPath: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(projectPath);
  } catch {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Project path is not a directory: ${projectPath}`);
  }
}

function detectPackageManager(projectPath: string): string | null {
  const candidates: Array<[string, string]> = [
    ["package-lock.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"]
  ];

  for (const [fileName, packageManager] of candidates) {
    if (fs.existsSync(path.join(projectPath, fileName))) {
      return packageManager;
    }
  }

  return null;
}
