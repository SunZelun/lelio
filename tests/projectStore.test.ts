import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/main/db/migrations";
import { JsonlLogger } from "../src/main/logging/logger";
import { ProjectStore } from "../src/main/projects/projectStore";
import type { GitCommandExecutor } from "../src/main/projects/gitStatus";

describe("ProjectStore", () => {
  it("adds, updates, refreshes, lists, and removes projects", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-project-store-"));
    const projectPath = path.join(root, "demo-app");
    fs.mkdirSync(projectPath);
    fs.writeFileSync(path.join(projectPath, "package-lock.json"), "{}", "utf8");

    const db = new DatabaseSync(path.join(root, "store.sqlite"));
    runMigrations(db);
    const logger = new JsonlLogger(path.join(root, "logs"), "debug", 14);
    const gitExecutor: GitCommandExecutor = async (command, args) => ({
      command,
      args,
      stdout: "## main...origin/main\n M src/index.ts\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      durationMs: 5
    });

    const store = new ProjectStore(db, logger, gitExecutor);
    const added = store.add({ path: projectPath, testCommand: "npm test" }, "correlation-add");

    expect(added.name).toBe("demo-app");
    expect(added.packageManager).toBe("npm");
    expect(added.gitStatus).toBe("unknown");
    expect(added.lastActivityAt).toBeTruthy();

    const updated = store.update({ id: added.id, name: "Demo App", buildCommand: "npm run build" }, "correlation-update");
    expect(updated.name).toBe("Demo App");
    expect(updated.buildCommand).toBe("npm run build");

    const refreshed = await store.refreshGitStatus(added.id, "correlation-refresh");
    expect(refreshed.gitStatus).toBe("dirty");
    expect(refreshed.gitBranch).toBe("main");
    expect(refreshed.gitChangedFilesCount).toBe(1);

    expect(store.list()).toHaveLength(1);
    expect(store.remove(added.id, "correlation-remove")).toEqual({ removed: true, id: added.id });
    expect(store.list()).toHaveLength(0);
  });
});
