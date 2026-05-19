import type { AgentProfile, Channel, DatabaseHealth, Project, RuntimeRecord } from "../../shared/schemas";
import type { SqliteDatabase } from "./sqlite";
import { runTransaction } from "./sqlite";

export const DEFAULT_AGENT_PROFILES = [
  {
    id: "agent-software-engineer",
    name: "Software Engineer",
    slug: "software-engineer",
    role: "coding task execution",
    providerType: "copilot",
    model: null,
    instructions: "Execute scoped coding tasks after approval gates and keep work tied to tasks.",
    enabled: true
  },
  {
    id: "agent-code-reviewer",
    name: "Code Reviewer",
    slug: "code-reviewer",
    role: "diff and architecture review",
    providerType: "openai-compatible",
    model: null,
    instructions: "Review diffs, tests, architecture risks, and missing coverage.",
    enabled: true
  },
  {
    id: "agent-researcher",
    name: "Researcher",
    slug: "researcher",
    role: "source-backed research",
    providerType: "openai-compatible",
    model: null,
    instructions: "Answer research questions using configured source-backed providers.",
    enabled: true
  },
  {
    id: "agent-planner",
    name: "Planner",
    slug: "planner",
    role: "implementation planning",
    providerType: "openai-compatible",
    model: null,
    instructions: "Turn vague requests into scoped implementation plans.",
    enabled: true
  },
  {
    id: "agent-critic",
    name: "Critic",
    slug: "critic",
    role: "risk finding",
    providerType: "openai-compatible",
    model: null,
    instructions: "Challenge assumptions and find failure modes before work starts.",
    enabled: true
  }
] as const;

export const DEFAULT_CHANNELS = [
  { id: "channel-explore", type: "group", name: "#explore", projectId: null },
  { id: "channel-planning", type: "group", name: "#planning", projectId: null },
  { id: "channel-reviews", type: "group", name: "#reviews", projectId: null },
  { id: "channel-ops", type: "group", name: "#ops", projectId: null }
] as const;

export function seedDefaults(db: SqliteDatabase): void {
  const now = new Date().toISOString();
  const insertAgent = db.prepare(`
    INSERT INTO agent_profiles (
      id, name, slug, role, provider_type, model, instructions, enabled, created_at, updated_at
    ) VALUES (
      @id, @name, @slug, @role, @providerType, @model, @instructions, @enabled, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      provider_type = excluded.provider_type,
      model = excluded.model,
      instructions = excluded.instructions,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);

  const insertChannel = db.prepare(`
    INSERT INTO channels (id, type, name, project_id, created_at, updated_at)
    VALUES (@id, @type, @name, @projectId, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      name = excluded.name,
      project_id = excluded.project_id,
      updated_at = excluded.updated_at
  `);

  runTransaction(db, () => {
    for (const agent of DEFAULT_AGENT_PROFILES) {
      insertAgent.run({
        ...agent,
        enabled: agent.enabled ? 1 : 0,
        createdAt: now,
        updatedAt: now
      });
    }

    for (const channel of DEFAULT_CHANNELS) {
      insertChannel.run({
        ...channel,
        createdAt: now,
        updatedAt: now
      });
    }
  });
}

export function listProjects(db: SqliteDatabase): Project[] {
  return db
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
      ORDER BY updated_at DESC
    `
    )
    .all()
    .map((row) => mapProjectRow(row as ProjectRow));
}

export type ProjectRow = Omit<Project, "metadata" | "gitDirty"> & {
  metadataJson: string | null;
  gitDirty: number | null;
};

export function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    path: row.path,
    defaultBranch: row.defaultBranch,
    packageManager: row.packageManager,
    testCommand: row.testCommand,
    buildCommand: row.buildCommand,
    metadata: row.metadataJson ? (JSON.parse(row.metadataJson) as Record<string, unknown>) : {},
    gitBranch: row.gitBranch,
    gitDirty: row.gitDirty === null ? null : Boolean(row.gitDirty),
    gitStatus: row.gitStatus,
    gitChangedFilesCount: row.gitChangedFilesCount,
    gitLastCheckedAt: row.gitLastCheckedAt,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function listAgents(db: SqliteDatabase): AgentProfile[] {
  const rows = db
    .prepare(
      `
      SELECT
        id, name, slug, role, provider_type AS providerType, model,
        instructions, enabled, created_at AS createdAt, updated_at AS updatedAt
      FROM agent_profiles
      ORDER BY name ASC
    `
    )
    .all() as Array<Omit<AgentProfile, "enabled"> & { enabled: number }>;

  return rows.map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
}

export function listChannels(db: SqliteDatabase): Channel[] {
  return db
    .prepare(
      `
      SELECT
        id, type, name, project_id AS projectId, created_at AS createdAt, updated_at AS updatedAt
      FROM channels
      ORDER BY name ASC
    `
    )
    .all() as Channel[];
}

export function listRuntimeRows(db: SqliteDatabase): RuntimeRecord[] {
  const rows = db
    .prepare(
      `
      SELECT
        id, provider_type AS providerType, name, cli_path AS cliPath, version, health,
        last_checked_at AS lastCheckedAt, last_heartbeat_at AS lastHeartbeatAt,
        metadata_json AS metadataJson
      FROM runtimes
      ORDER BY name ASC
    `
    )
    .all() as Array<Omit<RuntimeRecord, "metadata"> & { metadataJson: string | null }>;

  return rows.map((row) => ({
    id: row.id,
    providerType: row.providerType,
    name: row.name,
    cliPath: row.cliPath,
    version: row.version,
    health: row.health,
    lastCheckedAt: row.lastCheckedAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    metadata: row.metadataJson ? (JSON.parse(row.metadataJson) as Record<string, unknown>) : {}
  }));
}

export function getDatabaseHealth(db: SqliteDatabase, databasePath: string): DatabaseHealth {
  const migrationVersion =
    (db
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number }).version ?? 0;
  const tableCount =
    (db
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .get() as { count: number }).count ?? 0;
  const defaultAgentCount =
    (db.prepare("SELECT COUNT(*) AS count FROM agent_profiles").get() as { count: number }).count ?? 0;
  const defaultChannelCount =
    (db.prepare("SELECT COUNT(*) AS count FROM channels").get() as { count: number }).count ?? 0;

  return {
    ok: true,
    databasePath,
    migrationVersion,
    tableCount,
    defaultAgentCount,
    defaultChannelCount
  };
}
