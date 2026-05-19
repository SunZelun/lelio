import fs from "node:fs";
import type { AppSettings, AppSettingsPatch } from "../../shared/schemas";
import { SettingsPatchSchema, SettingsSchema } from "../../shared/schemas";
import type { LelioPaths } from "../paths";
import { redactValue } from "../logging/redaction";

export type StoredAppSettings = AppSettings & {
  openAiCompatibleApiKey: string | null;
};

export function defaultSettings(paths: LelioPaths): AppSettings {
  return {
    copilotCliPath: null,
    defaultCopilotModel: "default",
    corporateProviderName: "OpenAI-compatible",
    openAiCompatibleBaseUrl: null,
    openAiCompatibleModel: "gpt-4o-mini",
    openAiCompatibleUseStreaming: true,
    openAiCompatibleApiKeySet: false,
    quickChatChannelId: "channel-explore",
    worktreeRoot: paths.worktreeRoot,
    maxConcurrentCodingSessions: 3,
    maxConcurrentReviewSessions: 4,
    runtimeRefreshIntervalMinutes: 60,
    logLevel: "info",
    logRetentionDays: 14,
    diagnosticsExportLocation: null
  };
}

export function defaultStoredSettings(paths: LelioPaths): StoredAppSettings {
  const defaults = defaultSettings(paths);
  return {
    ...defaults,
    openAiCompatibleApiKey: null
  };
}

export class SettingsStore {
  constructor(private readonly paths: LelioPaths) {}

  get(): AppSettings {
    return publicSettings(this.getInternal());
  }

  getInternal(): StoredAppSettings {
    const defaults = defaultStoredSettings(this.paths);
    if (!fs.existsSync(this.paths.settingsPath)) {
      this.write(defaults);
      return defaults;
    }

    const parsed = JSON.parse(fs.readFileSync(this.paths.settingsPath, "utf8")) as unknown;
    const merged = { ...defaults, ...(parsed as Record<string, unknown>) };
    return storedSettings(merged);
  }

  update(patch: AppSettingsPatch): AppSettings {
    const validatedPatch = SettingsPatchSchema.parse(patch);
    const current = this.getInternal();
    const next = storedSettings({
      ...current,
      ...validatedPatch,
      openAiCompatibleApiKey:
        validatedPatch.openAiCompatibleApiKey === undefined ? current.openAiCompatibleApiKey : normalizeApiKey(validatedPatch.openAiCompatibleApiKey)
    });
    this.write(next);
    return publicSettings(next);
  }

  summary(): Record<string, unknown> {
    return redactValue(this.getInternal()) as Record<string, unknown>;
  }

  private write(settings: StoredAppSettings): void {
    fs.mkdirSync(this.paths.appDataRoot, { recursive: true });
    fs.writeFileSync(this.paths.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
}

function storedSettings(value: unknown): StoredAppSettings {
  const parsed = value as Record<string, unknown>;
  const publicParsed = SettingsSchema.parse({
    ...parsed,
    openAiCompatibleApiKeySet: Boolean(normalizeApiKey(typeof parsed.openAiCompatibleApiKey === "string" ? parsed.openAiCompatibleApiKey : null))
  });
  return {
    ...publicParsed,
    openAiCompatibleApiKey: normalizeApiKey(typeof parsed.openAiCompatibleApiKey === "string" ? parsed.openAiCompatibleApiKey : null)
  };
}

function publicSettings(settings: StoredAppSettings): AppSettings {
  const { openAiCompatibleApiKey, ...publicValue } = settings;
  return {
    ...publicValue,
    openAiCompatibleApiKeySet: Boolean(openAiCompatibleApiKey)
  };
}

function normalizeApiKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
