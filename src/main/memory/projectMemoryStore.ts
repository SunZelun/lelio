import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentSkillLinkInput,
  AttachedSkill,
  InstructionFile,
  LocalSkill,
  MemoryWarning,
  ProjectMemory,
  ProjectSkillLinkInput,
  SessionSummary,
  SkillCreateInput,
  SkillMountRecord,
  SkillUpdateInput,
  TaskMemory
} from "../../shared/schemas";
import type { SqliteDatabase } from "../db/sqlite";
import { runTransaction } from "../db/sqlite";
import type { JsonlLogger } from "../logging/logger";
import type { LelioPaths } from "../paths";
import { slugify } from "../projects/projectStore";

const MAX_DIRECTORY_ENTRIES = 200;
const MAX_CAPSULE_CHARS = 6000;
const MAX_SUMMARY_CHARS = 4000;
const CAPSULE_VERSION = 1;

type ProjectRow = {
  id: string;
  name: string;
  path: string;
  defaultBranch: string | null;
  packageManager: string | null;
  testCommand: string | null;
  buildCommand: string | null;
};

type TaskMemoryRow = {
  taskId: string;
  projectId: string | null;
  agentId: string | null;
};

type LocalSkillRow = Omit<LocalSkill, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type AttachedSkillRow = LocalSkillRow & {
  mountApproved: number;
  attachedAt: string;
  source: "project" | "agent";
};

type SessionSummaryRow = SessionSummary;

type SkillMountRow = SkillMountRecord;

export class ProjectMemoryStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly logger: JsonlLogger,
    private readonly paths: LelioPaths
  ) {}

  getProjectMemory(projectId: string): ProjectMemory {
    return this.buildProjectMemory(projectId, false);
  }

  refreshProjectMemory(projectId: string, correlationId: string): ProjectMemory {
    const memory = this.buildProjectMemory(projectId, true);
    this.logger.info({
      source: "memory",
      eventName: "memory.project.refresh",
      message: "Project memory refreshed",
      correlationId,
      metadata: {
        projectId,
        detectedInstructionFiles: memory.detectedInstructionFiles.length,
        warnings: memory.warnings.length
      }
    });
    return memory;
  }

  getTaskMemory(taskId: string): TaskMemory {
    const task = this.db
      .prepare("SELECT id AS taskId, project_id AS projectId, assignee_agent_id AS agentId FROM tasks WHERE id = ?")
      .get(taskId) as TaskMemoryRow | undefined;
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const projectMemory = task.projectId ? this.getProjectMemory(task.projectId) : null;
    const attachedSkills = this.attachedSkillsForTask(task.projectId, task.agentId);
    return {
      taskId,
      projectMemory,
      attachedSkills,
      mountableSkills: attachedSkills.filter((skill) => skill.mountApproved)
    };
  }

  listSkills(): LocalSkill[] {
    return (this.db
      .prepare(
        `
        SELECT id, name, slug, description, content, created_at AS createdAt, updated_at AS updatedAt
        FROM local_skills
        ORDER BY name ASC
      `
      )
      .all() as LocalSkillRow[]).map(mapLocalSkill);
  }

  createSkill(input: SkillCreateInput, correlationId: string): LocalSkill {
    const now = new Date().toISOString();
    const id = `skill-${crypto.randomUUID()}`;
    const slug = this.uniqueSkillSlug(slugify(input.name) || "skill");
    this.db
      .prepare(
        `
        INSERT INTO local_skills (id, name, slug, description, content, created_at, updated_at)
        VALUES (@id, @name, @slug, @description, @content, @createdAt, @updatedAt)
      `
      )
      .run({
        id,
        name: input.name.trim(),
        slug,
        description: normalizeNullableString(input.description ?? null),
        content: input.content.trim(),
        createdAt: now,
        updatedAt: now
      });
    this.logger.info({
      source: "memory",
      eventName: "skill.create",
      message: "Local skill created",
      correlationId,
      metadata: { skillId: id, slug }
    });
    return this.getSkillRequired(id);
  }

  updateSkill(input: SkillUpdateInput, correlationId: string): LocalSkill {
    const current = this.getSkillRequired(input.id);
    const now = new Date().toISOString();
    const nextName = input.name?.trim() ?? current.name;
    const nextSlug = nextName === current.name ? current.slug : this.uniqueSkillSlug(slugify(nextName) || "skill", current.id);
    this.db
      .prepare(
        `
        UPDATE local_skills
        SET name = @name,
            slug = @slug,
            description = @description,
            content = @content,
            updated_at = @updatedAt
        WHERE id = @id
      `
      )
      .run({
        id: input.id,
        name: nextName,
        slug: nextSlug,
        description: input.description === undefined ? current.description : normalizeNullableString(input.description),
        content: input.content?.trim() ?? current.content,
        updatedAt: now
      });
    this.logger.info({
      source: "memory",
      eventName: "skill.update",
      message: "Local skill updated",
      correlationId,
      metadata: { skillId: input.id, slug: nextSlug }
    });
    return this.getSkillRequired(input.id);
  }

  deleteSkill(skillId: string, correlationId: string): { deleted: true; id: string } {
    this.getSkillRequired(skillId);
    this.db.prepare("DELETE FROM local_skills WHERE id = ?").run(skillId);
    this.logger.info({
      source: "memory",
      eventName: "skill.delete",
      message: "Local skill deleted",
      correlationId,
      metadata: { skillId }
    });
    return { deleted: true, id: skillId };
  }

  attachSkillToProject(input: ProjectSkillLinkInput, correlationId: string): ProjectMemory {
    this.getProjectRequired(input.projectId);
    this.getSkillRequired(input.skillId);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO project_skill_links (project_id, skill_id, mount_approved, created_at, updated_at)
        VALUES (@projectId, @skillId, @mountApproved, @createdAt, @updatedAt)
        ON CONFLICT(project_id, skill_id) DO UPDATE SET
          mount_approved = excluded.mount_approved,
          updated_at = excluded.updated_at
      `
      )
      .run({
        projectId: input.projectId,
        skillId: input.skillId,
        mountApproved: input.mountApproved ? 1 : 0,
        createdAt: now,
        updatedAt: now
      });
    this.logger.info({
      source: "memory",
      eventName: "skill.attach.project",
      message: "Skill attached to project",
      correlationId,
      metadata: { projectId: input.projectId, skillId: input.skillId, mountApproved: Boolean(input.mountApproved) }
    });
    return this.getProjectMemory(input.projectId);
  }

  detachSkillFromProject(input: ProjectSkillLinkInput, correlationId: string): ProjectMemory {
    this.getProjectRequired(input.projectId);
    this.db.prepare("DELETE FROM project_skill_links WHERE project_id = ? AND skill_id = ?").run(input.projectId, input.skillId);
    this.logger.info({
      source: "memory",
      eventName: "skill.detach.project",
      message: "Skill detached from project",
      correlationId,
      metadata: { projectId: input.projectId, skillId: input.skillId }
    });
    return this.getProjectMemory(input.projectId);
  }

  attachSkillToAgent(input: AgentSkillLinkInput, correlationId: string): LocalSkill[] {
    this.assertAgent(input.agentId);
    this.getSkillRequired(input.skillId);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO agent_skill_links (agent_id, skill_id, mount_approved, created_at, updated_at)
        VALUES (@agentId, @skillId, @mountApproved, @createdAt, @updatedAt)
        ON CONFLICT(agent_id, skill_id) DO UPDATE SET
          mount_approved = excluded.mount_approved,
          updated_at = excluded.updated_at
      `
      )
      .run({
        agentId: input.agentId,
        skillId: input.skillId,
        mountApproved: input.mountApproved ? 1 : 0,
        createdAt: now,
        updatedAt: now
      });
    this.logger.info({
      source: "memory",
      eventName: "skill.attach.agent",
      message: "Skill attached to agent",
      correlationId,
      metadata: { agentId: input.agentId, skillId: input.skillId, mountApproved: Boolean(input.mountApproved) }
    });
    return this.listSkills();
  }

  detachSkillFromAgent(input: AgentSkillLinkInput, correlationId: string): LocalSkill[] {
    this.assertAgent(input.agentId);
    this.db.prepare("DELETE FROM agent_skill_links WHERE agent_id = ? AND skill_id = ?").run(input.agentId, input.skillId);
    this.logger.info({
      source: "memory",
      eventName: "skill.detach.agent",
      message: "Skill detached from agent",
      correlationId,
      metadata: { agentId: input.agentId, skillId: input.skillId }
    });
    return this.listSkills();
  }

  summarizeSession(sessionId: string, correlationId: string): SessionSummary {
    const row = this.db
      .prepare(
        `
        SELECT s.id AS sessionId, s.task_id AS taskId, s.project_id AS projectId, s.status, t.title AS taskTitle
        FROM sessions s
        LEFT JOIN tasks t ON t.id = s.task_id
        WHERE s.id = ?
      `
      )
      .get(sessionId) as { sessionId: string; taskId: string | null; projectId: string | null; status: string; taskTitle: string | null } | undefined;
    if (!row) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const messages = this.db
      .prepare(
        `
        SELECT rm.author_type AS authorType, rm.content_type AS contentType, rm.content, rm.created_at AS createdAt
        FROM run_messages rm
        JOIN execution_runs er ON er.id = rm.run_id
        WHERE er.session_id = ?
        ORDER BY rm.created_at DESC, rm.sequence_number DESC
        LIMIT 12
      `
      )
      .all(sessionId) as Array<{ authorType: string; contentType: string; content: string; createdAt: string }>;
    const summary = buildSessionSummary(row, messages.reverse());
    const now = new Date().toISOString();
    const record: SessionSummary = {
      id: `session-summary-${crypto.randomUUID()}`,
      sessionId,
      taskId: row.taskId,
      projectId: row.projectId,
      summary,
      createdAt: now
    };
    this.db
      .prepare(
        `
        INSERT INTO session_summaries (id, session_id, task_id, project_id, summary, created_at)
        VALUES (@id, @sessionId, @taskId, @projectId, @summary, @createdAt)
      `
      )
      .run(record);
    this.logger.info({
      source: "memory",
      eventName: "session.summary.create",
      message: "Session summary saved",
      correlationId,
      metadata: { sessionId, summaryId: record.id }
    });
    return record;
  }

  mountSkillsForRun(input: {
    runId: string;
    projectId: string;
    agentId: string;
    providerType: string;
    cwd: string;
    correlationId: string;
  }): SkillMountRecord[] {
    const skills = this.attachedSkillsForTask(input.projectId, input.agentId).filter((skill) => skill.mountApproved);
    if (skills.length === 0) {
      return [];
    }

    const now = new Date().toISOString();
    const project = this.getProjectRequired(input.projectId);
    const mounts = skills.map((skill) => {
      const targetPath = this.providerNativeSkillPath(input.providerType, input.cwd, skill.slug);
      return { skill, targetPath };
    });

    for (const mount of mounts) {
      ensureInside(input.cwd, mount.targetPath);
      fs.mkdirSync(path.dirname(mount.targetPath), { recursive: true });
      fs.writeFileSync(mount.targetPath, mount.skill.content, "utf8");
    }

    const records = mounts.map(({ skill, targetPath }) => ({
      id: `skill-mount-${crypto.randomUUID()}`,
      runId: input.runId,
      skillId: skill.id,
      skillName: skill.name,
      targetPath,
      providerType: input.providerType,
      mountedAt: now
    }));

    runTransaction(this.db, () => {
      for (const record of records) {
        this.db
          .prepare(
            `
            INSERT INTO run_skill_mounts (id, run_id, skill_id, skill_name, target_path, provider_type, mounted_at)
            VALUES (@id, @runId, @skillId, @skillName, @targetPath, @providerType, @mountedAt)
            ON CONFLICT(run_id, skill_id) DO UPDATE SET
              target_path = excluded.target_path,
              provider_type = excluded.provider_type,
              mounted_at = excluded.mounted_at
          `
          )
          .run(record);
        this.db
          .prepare(
            `
            INSERT INTO repo_instruction_writes (
              id, project_id, run_id, target_path, write_type, approval_reason, approved_at, created_at
            ) VALUES (
              @id, @projectId, @runId, @targetPath, @writeType, @approvalReason, @approvedAt, @createdAt
            )
          `
          )
          .run({
            id: `repo-write-${crypto.randomUUID()}`,
            projectId: project.id,
            runId: input.runId,
            targetPath: record.targetPath,
            writeType: "provider-native-skill-mount",
            approvalReason: "Skill attachment was approved for provider-native repo mounting",
            approvedAt: now,
            createdAt: now
          });
      }
    });

    this.logger.info({
      source: "memory",
      eventName: "skill.mount.run",
      message: "Approved skills mounted for run",
      correlationId: input.correlationId,
      metadata: { runId: input.runId, skillCount: records.length }
    });
    return records;
  }

  listRunSkillMounts(runId: string): SkillMountRecord[] {
    return this.skillMountRowsForRun(runId);
  }

  private buildProjectMemory(projectId: string, persistSnapshot: boolean): ProjectMemory {
    const project = this.getProjectRequired(projectId);
    const checkedAt = new Date().toISOString();
    const detection = detectInstructionFiles(project.path);
    const attachedSkills = this.attachedProjectSkills(project.id);
    const summaries = this.sessionSummariesForProject(project.id);
    const warnings = buildWarnings(detection.files, detection.warnings);
    const contextCapsule = buildContextCapsule(project, detection.files, attachedSkills, summaries);
    const latestSnapshotAt = this.latestSnapshotAt(project.id);

    if (persistSnapshot) {
      this.db
        .prepare(
          `
          INSERT INTO project_memory_snapshots (
            id, project_id, capsule, warnings_json, detected_files_json, capsule_version, detected_at, created_at
          ) VALUES (
            @id, @projectId, @capsule, @warningsJson, @detectedFilesJson, @capsuleVersion, @detectedAt, @createdAt
          )
        `
        )
        .run({
          id: `memory-snapshot-${crypto.randomUUID()}`,
          projectId: project.id,
          capsule: contextCapsule,
          warningsJson: JSON.stringify(warnings),
          detectedFilesJson: JSON.stringify(detection.files),
          capsuleVersion: CAPSULE_VERSION,
          detectedAt: checkedAt,
          createdAt: checkedAt
        });
    }

    return {
      projectId: project.id,
      projectName: project.name,
      checkedAt,
      detectedInstructionFiles: detection.files,
      warnings,
      contextCapsule,
      attachedSkills,
      sessionSummaries: summaries,
      latestSnapshotAt: persistSnapshot ? checkedAt : latestSnapshotAt
    };
  }

  private getProjectRequired(projectId: string): ProjectRow {
    const row = this.db
      .prepare(
        `
        SELECT
          id, name, path, default_branch AS defaultBranch, package_manager AS packageManager,
          test_command AS testCommand, build_command AS buildCommand
        FROM projects
        WHERE id = ?
      `
      )
      .get(projectId) as ProjectRow | undefined;
    if (!row) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return row;
  }

  private getSkillRequired(skillId: string): LocalSkill {
    const row = this.db
      .prepare(
        `
        SELECT id, name, slug, description, content, created_at AS createdAt, updated_at AS updatedAt
        FROM local_skills
        WHERE id = ?
      `
      )
      .get(skillId) as LocalSkillRow | undefined;
    if (!row) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    return mapLocalSkill(row);
  }

  private assertAgent(agentId: string): void {
    const row = this.db.prepare("SELECT 1 FROM agent_profiles WHERE id = ?").get(agentId);
    if (!row) {
      throw new Error(`Agent not found: ${agentId}`);
    }
  }

  private attachedSkillsForTask(projectId: string | null, agentId: string | null): AttachedSkill[] {
    const byId = new Map<string, AttachedSkill>();
    for (const skill of projectId ? this.attachedProjectSkills(projectId) : []) {
      byId.set(skill.id, skill);
    }
    for (const skill of agentId ? this.attachedAgentSkills(agentId) : []) {
      const existing = byId.get(skill.id);
      byId.set(skill.id, existing ? { ...existing, mountApproved: existing.mountApproved || skill.mountApproved } : skill);
    }
    return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  private attachedProjectSkills(projectId: string): AttachedSkill[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          s.id, s.name, s.slug, s.description, s.content, s.created_at AS createdAt, s.updated_at AS updatedAt,
          l.mount_approved AS mountApproved, l.created_at AS attachedAt, 'project' AS source
        FROM project_skill_links l
        JOIN local_skills s ON s.id = l.skill_id
        WHERE l.project_id = ?
        ORDER BY s.name ASC
      `
      )
      .all(projectId) as AttachedSkillRow[];
    return rows.map(mapAttachedSkill);
  }

  private attachedAgentSkills(agentId: string): AttachedSkill[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          s.id, s.name, s.slug, s.description, s.content, s.created_at AS createdAt, s.updated_at AS updatedAt,
          l.mount_approved AS mountApproved, l.created_at AS attachedAt, 'agent' AS source
        FROM agent_skill_links l
        JOIN local_skills s ON s.id = l.skill_id
        WHERE l.agent_id = ?
        ORDER BY s.name ASC
      `
      )
      .all(agentId) as AttachedSkillRow[];
    return rows.map(mapAttachedSkill);
  }

  private sessionSummariesForProject(projectId: string): SessionSummary[] {
    return this.db
      .prepare(
        `
        SELECT
          id, session_id AS sessionId, task_id AS taskId, project_id AS projectId,
          summary, created_at AS createdAt
        FROM session_summaries
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT 5
      `
      )
      .all(projectId) as SessionSummaryRow[];
  }

  private latestSnapshotAt(projectId: string): string | null {
    return (
      this.db
        .prepare("SELECT created_at AS createdAt FROM project_memory_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(projectId) as { createdAt: string } | undefined
    )?.createdAt ?? null;
  }

  private skillMountRowsForRun(runId: string): SkillMountRecord[] {
    return this.db
      .prepare(
        `
        SELECT
          id, run_id AS runId, skill_id AS skillId, skill_name AS skillName,
          target_path AS targetPath, provider_type AS providerType, mounted_at AS mountedAt
        FROM run_skill_mounts
        WHERE run_id = ?
        ORDER BY mounted_at ASC, skill_name ASC
      `
      )
      .all(runId) as SkillMountRow[];
  }

  private uniqueSkillSlug(baseSlug: string, currentId?: string): string {
    let slug = baseSlug;
    let suffix = 2;
    while (this.skillSlugExists(slug, currentId)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    return slug;
  }

  private skillSlugExists(slug: string, currentId?: string): boolean {
    const row = this.db.prepare("SELECT id FROM local_skills WHERE slug = ?").get(slug) as { id: string } | undefined;
    return Boolean(row && row.id !== currentId);
  }

  private providerNativeSkillPath(providerType: string, cwd: string, slug: string): string {
    if (providerType === "copilot") {
      return path.join(cwd, ".github", "skills", slug, "SKILL.md");
    }
    if (providerType === "claude") {
      return path.join(cwd, ".claude", "skills", slug, "SKILL.md");
    }
    if (providerType === "opencode") {
      return path.join(cwd, ".opencode", "skills", slug, "SKILL.md");
    }
    if (providerType === "codex" && process.env.CODEX_HOME) {
      return path.join(process.env.CODEX_HOME, "skills", slug, "SKILL.md");
    }
    return path.join(cwd, ".agent_context", "skills", slug, "SKILL.md");
  }
}

function detectInstructionFiles(projectPath: string): { files: InstructionFile[]; warnings: MemoryWarning[] } {
  const warnings: MemoryWarning[] = [];
  const files: InstructionFile[] = [];
  addFileIfPresent(files, warnings, projectPath, "AGENTS.md", "agents");
  addFileIfPresent(files, warnings, projectPath, path.join(".github", "copilot-instructions.md"), "copilot-instructions");
  files.push(...listMatchingFiles(projectPath, path.join(".github", "instructions"), "github-instructions", (name) => name.endsWith(".instructions.md"), warnings));
  files.push(...listMatchingFiles(projectPath, path.join(".github", "agents"), "github-agent", (name) => name.endsWith(".agent.md"), warnings));
  files.push(...listSkillFiles(projectPath, warnings));
  return {
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    warnings
  };
}

function addFileIfPresent(
  files: InstructionFile[],
  warnings: MemoryWarning[],
  projectPath: string,
  relativePath: string,
  kind: string
): void {
  const detected = readInstructionFile(projectPath, relativePath, kind, warnings);
  if (detected) {
    files.push(detected);
  }
}

function listMatchingFiles(
  projectPath: string,
  relativeDir: string,
  kind: string,
  predicate: (name: string) => boolean,
  warnings: MemoryWarning[]
): InstructionFile[] {
  const dir = path.resolve(projectPath, relativeDir);
  if (!isInside(projectPath, dir) || !fs.existsSync(dir)) {
    return [];
  }
  const stats = fs.lstatSync(dir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, MAX_DIRECTORY_ENTRIES);
  return entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && predicate(entry.name))
    .map((entry) => readInstructionFile(projectPath, path.join(relativeDir, entry.name), kind, warnings))
    .filter((file): file is InstructionFile => Boolean(file));
}

function listSkillFiles(projectPath: string, warnings: MemoryWarning[]): InstructionFile[] {
  const skillsDirRel = path.join(".github", "skills");
  const skillsDir = path.resolve(projectPath, skillsDirRel);
  if (!isInside(projectPath, skillsDir) || !fs.existsSync(skillsDir)) {
    return [];
  }
  const stats = fs.lstatSync(skillsDir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return [];
  }
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).slice(0, MAX_DIRECTORY_ENTRIES);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => readInstructionFile(projectPath, path.join(skillsDirRel, entry.name, "SKILL.md"), "github-skill", warnings))
    .filter((file): file is InstructionFile => Boolean(file));
}

function readInstructionFile(
  projectPath: string,
  relativePath: string,
  kind: string,
  warnings: MemoryWarning[]
): InstructionFile | null {
  const fullPath = path.resolve(projectPath, relativePath);
  if (!isInside(projectPath, fullPath) || !fs.existsSync(fullPath)) {
    return null;
  }
  const stats = fs.lstatSync(fullPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return null;
  }
  try {
    return {
      kind,
      path: normalizeRelativePath(relativePath),
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    warnings.push({
      code: "instruction-unreadable",
      severity: "warning",
      message: `Could not read instruction metadata for ${normalizeRelativePath(relativePath)}: ${errorMessage(error)}`
    });
    return null;
  }
}

function buildWarnings(files: InstructionFile[], existing: MemoryWarning[]): MemoryWarning[] {
  const warnings = [...existing];
  const broadGuidanceCount = files.filter((file) =>
    ["agents", "copilot-instructions", "github-instructions"].includes(file.kind)
  ).length;
  if (broadGuidanceCount === 0) {
    warnings.push({
      code: "missing-general-instructions",
      severity: "warning",
      message: "No general project instruction file was detected."
    });
  }
  if (broadGuidanceCount > 1) {
    warnings.push({
      code: "multiple-general-instructions",
      severity: "info",
      message: "Multiple broad instruction sources were detected; review them for overlap or conflicts."
    });
  }
  if (!files.some((file) => file.kind === "github-skill")) {
    warnings.push({
      code: "no-repo-skills",
      severity: "info",
      message: "No provider-native GitHub skill files were detected in the project."
    });
  }
  return warnings;
}

function buildContextCapsule(
  project: ProjectRow,
  files: InstructionFile[],
  attachedSkills: AttachedSkill[],
  summaries: SessionSummary[]
): string {
  const lines = [
    `Project: ${project.name}`,
    `Path: ${project.path}`,
    `Default branch: ${project.defaultBranch ?? "unknown"}`,
    `Package manager: ${project.packageManager ?? "unknown"}`,
    `Test command: ${project.testCommand ?? "not configured"}`,
    `Build command: ${project.buildCommand ?? "not configured"}`,
    "",
    "Detected instruction files:",
    ...(files.length === 0 ? ["- none"] : files.map((file) => `- ${file.path} (${file.kind}, ${file.sizeBytes} bytes)`)),
    "",
    "Attached local skills:",
    ...(attachedSkills.length === 0
      ? ["- none"]
      : attachedSkills.map((skill) => `- ${skill.name} (${skill.source}, repo mount ${skill.mountApproved ? "approved" : "not approved"})`)),
    "",
    "Recent session summaries:",
    ...(summaries.length === 0 ? ["- none"] : summaries.map((summary) => `- ${summary.summary.slice(0, 500)}`))
  ];
  return lines.join("\n").slice(0, MAX_CAPSULE_CHARS);
}

function buildSessionSummary(
  session: { sessionId: string; taskId: string | null; projectId: string | null; status: string; taskTitle: string | null },
  messages: Array<{ authorType: string; contentType: string; content: string; createdAt: string }>
): string {
  const lines = [
    `Session ${session.sessionId}`,
    `Task: ${session.taskTitle ?? session.taskId ?? "unlinked"}`,
    `Status: ${session.status}`,
    "Recent messages:",
    ...(messages.length === 0
      ? ["- no messages recorded"]
      : messages.map((message) => `- ${message.authorType}/${message.contentType}: ${message.content.replace(/\s+/g, " ").slice(0, 280)}`))
  ];
  return lines.join("\n").slice(0, MAX_SUMMARY_CHARS);
}

function mapLocalSkill(row: LocalSkillRow): LocalSkill {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapAttachedSkill(row: AttachedSkillRow): AttachedSkill {
  return {
    ...mapLocalSkill(row),
    mountApproved: Boolean(row.mountApproved),
    attachedAt: row.attachedAt,
    source: row.source
  };
}

function normalizeNullableString(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function ensureInside(root: string, targetPath: string): void {
  if (!isInside(root, targetPath)) {
    throw new Error(`Refusing to write skill outside working directory: ${targetPath}`);
  }
}

function isInside(root: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
