import type { JsonlLogger } from "../logging/logger";
import type { SqliteDatabase } from "./sqlite";
import { runTransaction } from "./sqlite";

export type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    version: 1,
    name: "phase_0_foundation_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL UNIQUE,
        default_branch TEXT,
        package_manager TEXT,
        test_command TEXT,
        build_command TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        model TEXT,
        instructions TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        author_type TEXT NOT NULL,
        author_id TEXT,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        assignee_agent_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
        due_at TEXT,
        branch TEXT,
        worktree_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        agent_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
        provider_type TEXT NOT NULL,
        model TEXT,
        external_session_id TEXT,
        cwd TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        last_event_at TEXT
      );

      CREATE TABLE IF NOT EXISTS execution_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL,
        worktree_path TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        exit_reason TEXT,
        last_sequence_number INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS run_messages (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
        sequence_number INTEGER NOT NULL,
        author_type TEXT NOT NULL,
        content_type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(run_id, sequence_number)
      );

      CREATE TABLE IF NOT EXISTS runtimes (
        id TEXT PRIMARY KEY,
        provider_type TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        cli_path TEXT,
        version TEXT,
        health TEXT NOT NULL,
        last_checked_at TEXT,
        last_heartbeat_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS log_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        correlation_id TEXT NOT NULL,
        level TEXT NOT NULL,
        source TEXT NOT NULL,
        event_name TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_log_events_correlation_id ON log_events(correlation_id);

      CREATE TABLE IF NOT EXISTS session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        action_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT,
        content_summary TEXT,
        created_at TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    name: "phase_1_project_registry_cache",
    sql: `
      ALTER TABLE projects ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE projects ADD COLUMN git_branch TEXT;
      ALTER TABLE projects ADD COLUMN git_dirty INTEGER;
      ALTER TABLE projects ADD COLUMN git_status TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE projects ADD COLUMN git_changed_files_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE projects ADD COLUMN git_last_checked_at TEXT;
      ALTER TABLE projects ADD COLUMN last_activity_at TEXT;

      CREATE INDEX IF NOT EXISTS idx_projects_last_activity_at ON projects(last_activity_at);
      CREATE INDEX IF NOT EXISTS idx_projects_git_status ON projects(git_status);
    `
  },
  {
    version: 3,
    name: "phase_3_session_run_indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_last_event_at ON sessions(last_event_at);
      CREATE INDEX IF NOT EXISTS idx_execution_runs_task_session ON execution_runs(task_id, session_id);
      CREATE INDEX IF NOT EXISTS idx_run_messages_run_sequence ON run_messages(run_id, sequence_number);
      CREATE INDEX IF NOT EXISTS idx_session_events_session_created ON session_events(session_id, created_at);
    `
  },
  {
    version: 4,
    name: "phase_5_project_memory",
    sql: `
      CREATE TABLE IF NOT EXISTS project_memory_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        capsule TEXT NOT NULL,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        detected_files_json TEXT NOT NULL DEFAULT '[]',
        capsule_version INTEGER NOT NULL DEFAULT 1,
        detected_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_summaries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS local_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_skill_links (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES local_skills(id) ON DELETE CASCADE,
        mount_approved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, skill_id)
      );

      CREATE TABLE IF NOT EXISTS agent_skill_links (
        agent_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES local_skills(id) ON DELETE CASCADE,
        mount_approved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, skill_id)
      );

      CREATE TABLE IF NOT EXISTS run_skill_mounts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES local_skills(id) ON DELETE CASCADE,
        skill_name TEXT NOT NULL,
        target_path TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        mounted_at TEXT NOT NULL,
        UNIQUE(run_id, skill_id)
      );

      CREATE TABLE IF NOT EXISTS repo_instruction_writes (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        run_id TEXT REFERENCES execution_runs(id) ON DELETE SET NULL,
        target_path TEXT NOT NULL,
        write_type TEXT NOT NULL,
        approval_reason TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_project_memory_snapshots_project_created ON project_memory_snapshots(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_session_created ON session_summaries(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_project_created ON session_summaries(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_run_skill_mounts_run ON run_skill_mounts(run_id);
    `
  },
  {
    version: 5,
    name: "phase_6_quick_chat_indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_author_created ON messages(author_type, created_at);
    `
  },
  {
    version: 6,
    name: "phase_7_group_review_channels",
    sql: `
      CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
        message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        author_type TEXT NOT NULL,
        author_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        checklist_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_comments_task_created ON task_comments(task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_task_comments_channel ON task_comments(channel_id);
      CREATE INDEX IF NOT EXISTS idx_task_comments_message ON task_comments(message_id);
      CREATE INDEX IF NOT EXISTS idx_messages_task_created ON messages(task_id, created_at);
    `
  },
  {
    version: 7,
    name: "phase_8_approval_guardrails",
    sql: `
      ALTER TABLE approvals ADD COLUMN run_id TEXT REFERENCES execution_runs(id) ON DELETE SET NULL;
      ALTER TABLE approvals ADD COLUMN request_id TEXT;
      ALTER TABLE approvals ADD COLUMN tool_call_id TEXT;
      ALTER TABLE approvals ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE approvals ADD COLUMN response_json TEXT;
      ALTER TABLE approvals ADD COLUMN resolution_reason TEXT;
      ALTER TABLE approvals ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

      CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_session_request
        ON approvals(session_id, request_id)
        WHERE request_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_approvals_status_requested ON approvals(status, requested_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_task_requested ON approvals(task_id, requested_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_session_requested ON approvals(session_id, requested_at);
    `
  }
];

export function runMigrations(db: SqliteDatabase, logger?: JsonlLogger): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((row) => row.version));

  runTransaction(db, () => {
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }

      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
      logger?.info({
        source: "db",
        eventName: "migration.applied",
        message: `Applied migration ${migration.version}`,
        metadata: { version: migration.version, name: migration.name }
      });
    }
  });
}
