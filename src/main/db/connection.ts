import type { JsonlLogger, LogEvent } from "../logging/logger";
import { runMigrations } from "./migrations";
import { seedDefaults } from "./schema";
import { createSqliteDatabase, type SqliteDatabase } from "./sqlite";

export type DatabaseHandle = {
  db: SqliteDatabase;
  databasePath: string;
};

export function openDatabase(databasePath: string, logger: JsonlLogger): DatabaseHandle {
  const db = createSqliteDatabase(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  logger.info({
    source: "db",
    eventName: "database.open",
    message: "SQLite database opened",
    metadata: { databasePath }
  });

  runMigrations(db, logger);
  seedDefaults(db);

  logger.setEventWriter((event: LogEvent) => {
    db.prepare(
      `
      INSERT INTO log_events (
        correlation_id, level, source, event_name, message, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      event.correlationId,
      event.level,
      event.source,
      event.eventName,
      event.message,
      JSON.stringify(event.metadata ?? {}),
      event.timestamp
    );
  });

  return { db, databasePath };
}
