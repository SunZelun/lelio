import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../src/main/settings/settingsStore";
import type { LelioPaths } from "../src/main/paths";

function testPaths(): LelioPaths {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-settings-"));
  return {
    appDataRoot: root,
    databasePath: path.join(root, "lelio.sqlite"),
    settingsPath: path.join(root, "settings.json"),
    worktreeRoot: path.join(root, "worktrees"),
    logsRoot: path.join(root, "logs"),
    desktopRoot: path.join(root, "Desktop")
  };
}

describe("SettingsStore", () => {
  it("creates defaults and validates updates", () => {
    const store = new SettingsStore(testPaths());
    const defaults = store.get();

    expect(defaults.maxConcurrentCodingSessions).toBe(3);
    expect(defaults.logLevel).toBe("info");
    expect(defaults.openAiCompatibleApiKeySet).toBe(false);

    const updated = store.update({ logLevel: "debug", logRetentionDays: 7, openAiCompatibleApiKey: "sk-test-secret" });
    expect(updated.logLevel).toBe("debug");
    expect(updated.logRetentionDays).toBe(7);
    expect(updated.openAiCompatibleApiKeySet).toBe(true);
    expect("openAiCompatibleApiKey" in updated).toBe(false);
    expect(store.getInternal().openAiCompatibleApiKey).toBe("sk-test-secret");
  });
});
