import { DatabaseSync } from "node:sqlite";

export type SqliteDatabase = DatabaseSync;

export function createSqliteDatabase(databasePath: string): SqliteDatabase {
  return new DatabaseSync(databasePath, { timeout: 5000 });
}

export function runTransaction(db: SqliteDatabase, work: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}
