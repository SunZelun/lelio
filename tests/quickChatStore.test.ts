import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { QuickChatStore } from "../src/main/chat/quickChatStore";
import { runMigrations } from "../src/main/db/migrations";
import { seedDefaults } from "../src/main/db/schema";
import { JsonlLogger } from "../src/main/logging/logger";
import { getLelioPaths } from "../src/main/paths";
import { OpenAiCompatibleAdapter } from "../src/main/runtime/openAiCompatibleAdapter";
import { SettingsStore } from "../src/main/settings/settingsStore";

describe("QuickChatStore", () => {
  it("persists user and assistant messages for quick chat", async () => {
    const { store } = createStore(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "Stored answer" } }] }), { status: 200 })
    );

    const result = await store.send({ message: "What is this app for?", clientRequestId: "request-1" }, "quick-chat");
    expect(result.errorMessage).toBeNull();
    expect(result.userMessage.content).toBe("What is this app for?");
    expect(result.assistantMessage.content).toBe("Stored answer");
    expect(store.listMessages("channel-explore").map((message) => message.authorType)).toEqual(["user", "assistant"]);
  });

  it("stores provider failures as system messages without throwing", async () => {
    const { store } = createStore(async () => new Response("nope", { status: 500 }));

    const result = await store.send({ message: "Will this fail?", clientRequestId: "request-2" }, "quick-chat");
    expect(result.errorMessage).toContain("HTTP 500");
    expect(result.assistantMessage.authorType).toBe("system");
    expect(store.listMessages("channel-explore").map((message) => message.authorType)).toEqual(["user", "system"]);
  });

  it("rejects missing provider settings before writing messages", async () => {
    const { store, settingsStore } = createStore(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "unused" } }] }), { status: 200 })
    );
    settingsStore.update({ openAiCompatibleBaseUrl: null });

    await expect(store.send({ message: "No settings" }, "quick-chat")).rejects.toThrow("base URL");
    expect(store.listMessages("channel-explore")).toHaveLength(0);
  });
});

function createStore(fetchImpl: typeof fetch): { store: QuickChatStore; settingsStore: SettingsStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-quick-chat-"));
  const db = new DatabaseSync(path.join(root, "quick-chat.sqlite"));
  runMigrations(db);
  seedDefaults(db);
  const logger = new JsonlLogger(path.join(root, "logs"), "debug", 14);
  const settingsStore = new SettingsStore({ ...getLelioPaths(), appDataRoot: root, settingsPath: path.join(root, "settings.json") });
  settingsStore.update({
    openAiCompatibleBaseUrl: "https://llm.example.com/v1",
    openAiCompatibleApiKey: "sk-test",
    openAiCompatibleModel: "test-model",
    openAiCompatibleUseStreaming: false
  });
  const adapter = new OpenAiCompatibleAdapter(() => settingsStore.getInternal(), fetchImpl);
  return {
    store: new QuickChatStore(db, logger, settingsStore, adapter),
    settingsStore
  };
}
