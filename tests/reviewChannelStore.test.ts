import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ReviewChannelStore } from "../src/main/chat/reviewChannelStore";
import { runMigrations } from "../src/main/db/migrations";
import { seedDefaults } from "../src/main/db/schema";
import { JsonlLogger } from "../src/main/logging/logger";
import { getLelioPaths } from "../src/main/paths";
import { OpenAiCompatibleAdapter } from "../src/main/runtime/openAiCompatibleAdapter";
import { SettingsStore } from "../src/main/settings/settingsStore";

describe("ReviewChannelStore", () => {
  it("runs a review round with three agent replies linked to a task", async () => {
    const { db, store } = createStore(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      const systemMessage = body.messages.find((message) => message.role === "system")?.content ?? "";
      return jsonResponse(`Reply from ${systemMessage.split("\n")[0]}`);
    });

    const result = await store.runReviewRound(
      {
        channelId: "channel-reviews",
        taskId: "task-review",
        prompt: "Review the implementation plan",
        agentIds: ["agent-code-reviewer", "agent-researcher", "agent-planner"],
        clientRequestId: "round-1"
      },
      "review-test"
    );

    expect(result.errorCount).toBe(0);
    expect(result.replies).toHaveLength(3);
    expect(result.replies.map((reply) => reply.agentName).sort()).toEqual(["Code Reviewer", "Planner", "Researcher"]);
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM messages WHERE channel_id = 'channel-reviews' AND task_id = 'task-review'")
        .get()
    ).toMatchObject({ count: 4 });
  });

  it("persists per-agent provider failures without failing the whole review round", async () => {
    let calls = 0;
    const { db, store } = createStore(async () => {
      calls += 1;
      return calls === 2 ? new Response("nope", { status: 500 }) : jsonResponse(`ok-${calls}`);
    });

    const result = await store.runReviewRound(
      {
        channelId: "channel-reviews",
        taskId: "task-review",
        prompt: "Review with one failing provider call",
        agentIds: ["agent-code-reviewer", "agent-researcher", "agent-planner"],
        clientRequestId: "round-2"
      },
      "review-test"
    );

    expect(result.replies).toHaveLength(3);
    expect(result.errorCount).toBe(1);
    expect(result.replies.some((reply) => reply.message.authorType === "system" && reply.errorMessage?.includes("HTTP 500"))).toBe(true);
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM messages WHERE json_extract(metadata_json, '$.source') = 'review-round'")
        .get()
    ).toMatchObject({ count: 4 });
  });

  it("synthesizes review messages into a task comment and checklist", async () => {
    const { store } = createStore(async () =>
      jsonResponse("Synthesis\n- [ ] Add tests\n- [x] Keep provider secrets redacted")
    );

    const result = await store.synthesize(
      {
        channelId: "channel-reviews",
        taskId: "task-review",
        instructions: "Create a checklist"
      },
      "review-test"
    );

    expect(result.errorMessage).toBeNull();
    expect(result.taskComment?.checklist).toEqual([
      { text: "Add tests", checked: false },
      { text: "Keep provider secrets redacted", checked: true }
    ]);
    expect(store.listTaskComments("task-review")).toHaveLength(1);
  });

  it("rejects misconfigured providers before writing review messages", async () => {
    const { db, store, settingsStore } = createStore(async () => jsonResponse("unused"));
    settingsStore.update({ openAiCompatibleBaseUrl: null });

    await expect(
      store.runReviewRound(
        {
          channelId: "channel-reviews",
          taskId: "task-review",
          prompt: "Should not write",
          agentIds: ["agent-code-reviewer", "agent-researcher", "agent-planner"]
        },
        "review-test"
      )
    ).rejects.toThrow("base URL");
    expect(db.prepare("SELECT COUNT(*) AS count FROM messages").get()).toMatchObject({ count: 0 });
  });
});

function createStore(fetchImpl: typeof fetch): {
  db: DatabaseSync;
  store: ReviewChannelStore;
  settingsStore: SettingsStore;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-review-channel-"));
  const db = new DatabaseSync(path.join(root, "review.sqlite"));
  runMigrations(db);
  seedDefaults(db);
  seedTask(db);
  const logger = new JsonlLogger(path.join(root, "logs"), "debug", 14);
  const settingsStore = new SettingsStore({ ...getLelioPaths(), appDataRoot: root, settingsPath: path.join(root, "settings.json") });
  settingsStore.update({
    openAiCompatibleBaseUrl: "https://llm.example.com/v1",
    openAiCompatibleApiKey: "sk-test",
    openAiCompatibleModel: "test-model",
    openAiCompatibleUseStreaming: false,
    maxConcurrentReviewSessions: 3
  });
  const adapter = new OpenAiCompatibleAdapter(() => settingsStore.getInternal(), fetchImpl);
  return {
    db,
    store: new ReviewChannelStore(db, logger, settingsStore, adapter),
    settingsStore
  };
}

function seedTask(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO projects (
      id, name, slug, path, default_branch, package_manager, test_command, build_command, created_at, updated_at
    ) VALUES (
      'project-review', 'Review Project', 'review-project', '/tmp/review-project', 'main', null, null, null, @now, @now
    )
  `
  ).run({ now });
  db.prepare(
    `
    INSERT INTO tasks (
      id, project_id, title, description, status, priority, assignee_agent_id, due_at, branch, worktree_path, created_at, updated_at
    ) VALUES (
      'task-review', 'project-review', 'Review task', 'Task under review', 'review', 'high', 'agent-software-engineer', null, null, null, @now, @now
    )
  `
  ).run({ now });
}

function jsonResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}
