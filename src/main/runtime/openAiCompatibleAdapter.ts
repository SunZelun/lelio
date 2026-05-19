import type { StoredAppSettings } from "../settings/settingsStore";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionInput = {
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  provider: string;
  streamed: boolean;
};

type FetchLike = typeof fetch;

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

export class ProviderRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

export class OpenAiCompatibleAdapter {
  constructor(
    private readonly getSettings: () => StoredAppSettings,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  assertConfigured(): void {
    const settings = this.getSettings();
    if (!settings.openAiCompatibleBaseUrl) {
      throw new ProviderConfigurationError("OpenAI-compatible base URL is not configured");
    }
    if (!settings.openAiCompatibleModel) {
      throw new ProviderConfigurationError("OpenAI-compatible model is not configured");
    }
    if (!settings.openAiCompatibleApiKey) {
      throw new ProviderConfigurationError("OpenAI-compatible API key is not configured");
    }
  }

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    this.assertConfigured();
    const settings = this.getSettings();
    const stream = settings.openAiCompatibleUseStreaming;
    const response = await this.safeFetch(settings, input.messages, stream, input.signal);
    if (!response.ok) {
      throw new ProviderRequestError(`Provider request failed with HTTP ${response.status}`);
    }

    const content = stream
      ? await readStreamingResponse(response, input.onDelta)
      : await readJsonResponse(response);

    return {
      content,
      model: settings.openAiCompatibleModel,
      provider: settings.corporateProviderName,
      streamed: stream
    };
  }

  private async safeFetch(
    settings: StoredAppSettings,
    messages: ChatMessage[],
    stream: boolean,
    signal?: AbortSignal
  ): Promise<Response> {
    try {
      return await this.fetchImpl(endpointUrl(settings.openAiCompatibleBaseUrl as string), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.openAiCompatibleApiKey as string}`
        },
        body: JSON.stringify({
          model: settings.openAiCompatibleModel,
          messages,
          stream
        }),
        signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderRequestError("Provider request was cancelled");
      }
      throw new ProviderRequestError(`Provider request failed: ${errorMessage(error)}`);
    }
  }
}

export function endpointUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export async function readJsonResponse(response: Response): Promise<string> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (error) {
    throw new ProviderRequestError(`Provider returned invalid JSON: ${errorMessage(error)}`);
  }
  const content = (parsed as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new ProviderRequestError("Provider response did not include assistant content");
  }
  return content;
}

export async function readStreamingResponse(response: Response, onDelta?: (delta: string) => void): Promise<string> {
  if (!response.body) {
    throw new ProviderRequestError("Provider streaming response did not include a body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const delta = parseSseLine(line);
        if (delta) {
          content += delta;
          onDelta?.(delta);
        }
      }
    }
    buffer += decoder.decode();
    const trailing = parseSseLine(buffer);
    if (trailing) {
      content += trailing;
      onDelta?.(trailing);
    }
    return content;
  } catch (error) {
    if (content) {
      return content;
    }
    throw new ProviderRequestError(`Provider stream failed: ${errorMessage(error)}`);
  }
}

function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "data: [DONE]" || !trimmed.startsWith("data:")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.replace(/^data:\s*/, "")) as {
      choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
    };
    const content = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : null;
  } catch (error) {
    throw new ProviderRequestError(`Provider stream contained invalid JSON: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
