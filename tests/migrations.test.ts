import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/main/db/migrations";
import { DEFAULT_AGENT_PROFILES, DEFAULT_CHANNELS, getDatabaseHealth, seedDefaults } from "../src/main/db/schema";

describe("SQLite migrations", () => {
  it("creates Phase 0 tables and seeds defaults", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-db-"));
    const dbPath = path.join(root, "test.sqlite");
    const db = new DatabaseSync(dbPath);

    runMigrations(db);
    seedDefaults(db);

    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tableNames).toContain("projects");
    expect(tableNames).toContain("agent_profiles");
    expect(tableNames).toContain("channels");
    expect(tableNames).toContain("runtimes");
    expect(tableNames).toContain("log_events");
    expect(tableNames).toContain("task_comments");

    const health = getDatabaseHealth(db, dbPath);
    expect(health.migrationVersion).toBe(7);
    expect(health.defaultAgentCount).toBe(DEFAULT_AGENT_PROFILES.length);
    expect(health.defaultChannelCount).toBe(DEFAULT_CHANNELS.length);
  });
});
