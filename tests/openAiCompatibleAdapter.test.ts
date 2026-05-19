import { describe, expect, it } from "vitest";
import {
  endpointUrl,
  OpenAiCompatibleAdapter,
  readStreamingResponse
} from "../src/main/runtime/openAiCompatibleAdapter";
import type { StoredAppSettings } from "../src/main/settings/settingsStore";

describe("OpenAiCompatibleAdapter", () => {
  it("uses the configured base URL as authoritative", () => {
    expect(endpointUrl("https://llm.example.com/v1/")).toBe("https://llm.example.com/v1/chat/completions");
  });

  it("parses streaming response deltas", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'
          )
        );
        controller.close();
      }
    });
    const deltas: string[] = [];
    const content = await readStreamingResponse(new Response(body), (delta) => deltas.push(delta));
    expect(content).toBe("Hello");
    expect(deltas).toEqual(["Hel", "lo"]);
  });

  it("sends non-streaming OpenAI-compatible requests", async () => {
    const calls: Array<{ url: string; body: unknown; authorization: string | null }> = [];
    const adapter = new OpenAiCompatibleAdapter(
      () => settings({ openAiCompatibleUseStreaming: false }),
      (async (url, init) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
          authorization: new Headers(init?.headers).get("authorization")
        });
        return new Response(JSON.stringify({ choices: [{ message: { content: "Adapter response" } }] }), { status: 200 });
      }) as typeof fetch
    );

    await expect(adapter.complete({ messages: [{ role: "user", content: "Hello" }] })).resolves.toMatchObject({
      content: "Adapter response",
      model: "test-model",
      streamed: false
    });
    expect(calls[0]).toMatchObject({
      url: "https://llm.example.com/v1/chat/completions",
      authorization: "Bearer sk-test"
    });
  });
});

function settings(patch: Partial<StoredAppSettings> = {}): StoredAppSettings {
  return {
    copilotCliPath: null,
    defaultCopilotModel: "default",
    corporateProviderName: "Test Provider",
    openAiCompatibleBaseUrl: "https://llm.example.com/v1",
    openAiCompatibleModel: "test-model",
    openAiCompatibleUseStreaming: true,
    openAiCompatibleApiKeySet: true,
    openAiCompatibleApiKey: "sk-test",
    quickChatChannelId: "channel-explore",
    worktreeRoot: "/tmp/worktrees",
    maxConcurrentCodingSessions: 3,
    maxConcurrentReviewSessions: 4,
    runtimeRefreshIntervalMinutes: 60,
    logLevel: "info",
    logRetentionDays: 14,
    diagnosticsExportLocation: null,
    ...patch
  };
}
