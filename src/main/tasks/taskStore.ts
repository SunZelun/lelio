import crypto from "node:crypto";
import type { Task, TaskCreateInput, TaskPriority, TaskStatus, TaskUpdateInput } from "../../shared/schemas";
import type { SqliteDatabase } from "../db/sqlite";
import type { JsonlLogger } from "../logging/logger";

type TaskRow = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  assigneeAgentName: string | null;
  dueAt: string | null;
  branch: string | null;
  worktreePath: string | null;
  sessionId: string | null;
  sessionStatus: string | null;
  lastActivityAt: string | null;
  changedFilesCount: number | null;
  testStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

const TASK_SELECT = `
  SELECT
    t.id,
    t.project_id AS projectId,
    p.name AS projectName,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.assignee_agent_id AS assigneeAgentId,
    a.name AS assigneeAgentName,
    t.due_at AS dueAt,
    t.branch,
    t.worktree_path AS worktreePath,
    COALESCE(s.external_session_id, s.id) AS sessionId,
    s.status AS sessionStatus,
    COALESCE(s.last_event_at, t.updated_at) AS lastActivityAt,
    CASE WHEN p.id IS NULL THEN NULL ELSE p.git_changed_files_count END AS changedFilesCount,
    NULL AS testStatus,
    t.created_at AS createdAt,
    t.updated_at AS updatedAt
  FROM tasks t
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN agent_profiles a ON a.id = t.assignee_agent_id
  LEFT JOIN sessions s ON s.id = (
    SELECT candidate.id
    FROM sessions candidate
    WHERE candidate.task_id = t.id
    ORDER BY COALESCE(candidate.last_event_at, candidate.started_at, candidate.ended_at, '') DESC, candidate.id DESC
    LIMIT 1
  )
`;

export class TaskStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly logger: JsonlLogger
  ) {}

  list(): Task[] {
    return this.db
      .prepare(
        `
        ${TASK_SELECT}
        ORDER BY COALESCE(s.last_event_at, t.updated_at) DESC, t.created_at DESC
      `
      )
      .all()
      .map((row) => mapTaskRow(row as TaskRow));
  }

  create(input: TaskCreateInput, correlationId: string): Task {
    this.assertProject(input.projectId);
    this.assertAgent(input.assigneeAgentId ?? null);

    const now = new Date().toISOString();
    const id = `task-${crypto.randomUUID()}`;

    this.db
      .prepare(
        `
        INSERT INTO tasks (
          id, project_id, title, description, status, priority, assignee_agent_id,
          due_at, branch, worktree_path, created_at, updated_at
        ) VALUES (
          @id, @projectId, @title, @description, @status, @priority, @assigneeAgentId,
          @dueAt, @branch, @worktreePath, @createdAt, @updatedAt
        )
      `
      )
      .run({
        id,
        projectId: input.projectId,
        title: input.title.trim(),
        description: normalizeNullableString(input.description ?? null),
        status: input.status ?? "open",
        priority: input.priority ?? "medium",
        assigneeAgentId: input.assigneeAgentId ?? null,
        dueAt: normalizeNullableString(input.dueAt ?? null),
        branch: normalizeNullableString(input.branch ?? null),
        worktreePath: normalizeNullableString(input.worktreePath ?? null),
        createdAt: now,
        updatedAt: now
      });

    this.touchProject(input.projectId, now);
    this.logger.info({
      source: "task",
      eventName: "task.create",
      message: "Task created",
      correlationId,
      metadata: { taskId: id, projectId: input.projectId }
    });

    return this.getRequired(id);
  }

  update(input: TaskUpdateInput, correlationId: string): Task {
    const current = this.getRequired(input.id);
    this.assertProject(input.projectId ?? null);
    this.assertAgent(input.assigneeAgentId ?? null);

    const now = new Date().toISOString();
    const nextProjectId = input.projectId === undefined ? current.projectId : input.projectId;

    this.db
      .prepare(
        `
        UPDATE tasks
        SET project_id = @projectId,
            title = @title,
            description = @description,
            status = @status,
            priority = @priority,
            assignee_agent_id = @assigneeAgentId,
            due_at = @dueAt,
            branch = @branch,
            worktree_path = @worktreePath,
            updated_at = @updatedAt
        WHERE id = @id
      `
      )
      .run({
        id: input.id,
        projectId: nextProjectId,
        title: input.title?.trim() ?? current.title,
        description: input.description === undefined ? current.description : normalizeNullableString(input.description),
        status: input.status ?? current.status,
        priority: input.priority ?? current.priority,
        assigneeAgentId: input.assigneeAgentId === undefined ? current.assigneeAgentId : input.assigneeAgentId,
        dueAt: input.dueAt === undefined ? current.dueAt : normalizeNullableString(input.dueAt),
        branch: input.branch === undefined ? current.branch : normalizeNullableString(input.branch),
        worktreePath: input.worktreePath === undefined ? current.worktreePath : normalizeNullableString(input.worktreePath),
        updatedAt: now
      });

    if (current.projectId) {
      this.touchProject(current.projectId, now);
    }
    if (nextProjectId && nextProjectId !== current.projectId) {
      this.touchProject(nextProjectId, now);
    }

    this.logger.info({
      source: "task",
      eventName: "task.update",
      message: "Task updated",
      correlationId,
      metadata: { taskId: input.id, projectId: nextProjectId, status: input.status }
    });

    return this.getRequired(input.id);
  }

  delete(id: string, correlationId: string): { deleted: true; id: string } {
    const current = this.getRequired(id);
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    if (current.projectId) {
      this.touchProject(current.projectId, new Date().toISOString());
    }

    this.logger.info({
      source: "task",
      eventName: "task.delete",
      message: "Task deleted",
      correlationId,
      metadata: { taskId: id, projectId: current.projectId }
    });

    return { deleted: true, id };
  }

  getRequired(id: string): Task {
    const row = this.db
      .prepare(
        `
        ${TASK_SELECT}
        WHERE t.id = ?
      `
      )
      .get(id) as TaskRow | undefined;

    if (!row) {
      throw new Error(`Task not found: ${id}`);
    }

    return mapTaskRow(row);
  }

  private assertProject(projectId: string | null): void {
    if (!projectId) {
      return;
    }

    const row = this.db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId);
    if (!row) {
      throw new Error(`Project not found: ${projectId}`);
    }
  }

  private assertAgent(agentId: string | null): void {
    if (!agentId) {
      return;
    }

    const row = this.db.prepare("SELECT 1 FROM agent_profiles WHERE id = ?").get(agentId);
    if (!row) {
      throw new Error(`Agent not found: ${agentId}`);
    }
  }

  private touchProject(projectId: string, timestamp: string): void {
    this.db
      .prepare(
        `
        UPDATE projects
        SET last_activity_at = @timestamp,
            updated_at = @timestamp
        WHERE id = @projectId
      `
      )
      .run({ projectId, timestamp });
  }
}

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    assigneeAgentId: row.assigneeAgentId,
    assigneeAgentName: row.assigneeAgentName,
    dueAt: row.dueAt,
    branch: row.branch,
    worktreePath: row.worktreePath,
    sessionId: row.sessionId,
    sessionStatus: row.sessionStatus,
    lastActivityAt: row.lastActivityAt,
    changedFilesCount: row.changedFilesCount,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeNullableString(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
