import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/main/db/migrations";
import { JsonlLogger } from "../src/main/logging/logger";
import { RuntimeRegistry, type RuntimeCommandExecutor } from "../src/main/runtime/runtimeRegistry";

describe("RuntimeRegistry", () => {
  it("detects mocked CLI paths and versions without starting sessions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-runtime-"));
    const db = new DatabaseSync(path.join(root, "runtime.sqlite"));
    runMigrations(db);
    const logger = new JsonlLogger(path.join(root, "logs"), "debug", 14);

    const executor: RuntimeCommandExecutor = async (command, args, _timeoutMs) => {
      if (command === "which" && args[0] === "copilot") {
        return result(command, args, "/opt/homebrew/bin/copilot\n");
      }
      if (command === "/opt/homebrew/bin/copilot") {
        return result(command, args, "1.0.49\n");
      }
      return result(command, args, "", "missing", 1);
    };

    const registry = new RuntimeRegistry(db, logger, executor, 25);
    const refreshed = await registry.refresh("test-correlation-id");
    const copilot = refreshed.find((runtime) => runtime.providerType === "copilot");

    expect(copilot?.cliPath).toBe("/opt/homebrew/bin/copilot");
    expect(copilot?.version).toBe("1.0.49");
    expect(copilot?.health).toBe("available");
    expect(registry.listCached().find((runtime) => runtime.providerType === "copilot")?.version).toBe("1.0.49");
  });
});

function result(command: string, args: string[], stdout: string, stderr = "", exitCode = 0) {
  return {
    command,
    args,
    stdout,
    stderr,
    exitCode,
    timedOut: false,
    durationMs: 1
  };
}
