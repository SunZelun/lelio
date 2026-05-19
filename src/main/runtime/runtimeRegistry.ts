import { execFile } from "node:child_process";
import type { CommandResult, RuntimeProvider, RuntimeRecord } from "../../shared/types";
import type { JsonlLogger } from "../logging/logger";
import { listRuntimeRows } from "../db/schema";
import { redactValue } from "../logging/redaction";
import type { SqliteDatabase } from "../db/sqlite";

export type RuntimeCommandExecutor = (
  command: string,
  args: string[],
  timeoutMs: number
) => Promise<CommandResult>;

type RuntimeSpec = {
  providerType: RuntimeProvider;
  name: string;
  binary: string;
  versionArgs: string[];
};

export const RUNTIME_SPECS: RuntimeSpec[] = [
  { providerType: "copilot", name: "GitHub Copilot CLI", binary: "copilot", versionArgs: ["--version"] },
  { providerType: "codex", name: "Codex", binary: "codex", versionArgs: ["--version"] },
  { providerType: "claude", name: "Claude Code", binary: "claude", versionArgs: ["--version"] },
  { providerType: "gemini", name: "Gemini CLI", binary: "gemini", versionArgs: ["--version"] },
  { providerType: "opencode", name: "OpenCode", binary: "opencode", versionArgs: ["--version"] },
  { providerType: "hermes", name: "Hermes", binary: "hermes", versionArgs: ["--version"] }
];

export function defaultCommandExecutor(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      const maybeError = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      const timedOut = Boolean(maybeError && maybeError.killed);
      resolve({
        command,
        args,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: typeof maybeError?.code === "number" ? maybeError.code : maybeError ? 1 : 0,
        timedOut,
        durationMs: Date.now() - started
      });
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      resolve({
        command,
        args,
        stdout: "",
        stderr: error.message,
        exitCode: 1,
        timedOut: false,
        durationMs: Date.now() - started
      });
    });
  });
}

export class RuntimeRegistry {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly logger: JsonlLogger,
    private readonly executor: RuntimeCommandExecutor = defaultCommandExecutor,
    private readonly commandTimeoutMs = 1500
  ) {}

  listCached(): RuntimeRecord[] {
    const cachedByProvider = new Map(listRuntimeRows(this.db).map((runtime) => [runtime.providerType, runtime]));
    return RUNTIME_SPECS.map((spec) => {
      const cached = cachedByProvider.get(spec.providerType);
      return (
        cached ?? {
          id: `runtime-${spec.providerType}`,
          providerType: spec.providerType,
          name: spec.name,
          cliPath: null,
          version: null,
          health: "unavailable",
          lastCheckedAt: null,
          lastHeartbeatAt: null,
          metadata: { reason: "not checked" }
        }
      );
    });
  }

  async refresh(correlationId: string): Promise<RuntimeRecord[]> {
    const checkedAt = new Date().toISOString();
    const records: RuntimeRecord[] = [];

    for (const spec of RUNTIME_SPECS) {
      const record = await this.checkRuntime(spec, checkedAt, correlationId);
      this.upsert(record);
      records.push(record);
    }

    return records;
  }

  private async checkRuntime(spec: RuntimeSpec, checkedAt: string, correlationId: string): Promise<RuntimeRecord> {
    this.logger.info({
      source: "runtime",
      eventName: "runtime.check.start",
      message: "Checking runtime CLI",
      correlationId,
      metadata: { providerType: spec.providerType, binary: spec.binary }
    });

    const pathCheck = await this.executor("which", [spec.binary], this.commandTimeoutMs);
    const cliPath = pathCheck.stdout.trim().split(/\r?\n/)[0] || null;
    if (pathCheck.exitCode !== 0 || !cliPath) {
      const unavailable = {
        id: `runtime-${spec.providerType}`,
        providerType: spec.providerType,
        name: spec.name,
        cliPath: null,
        version: null,
        health: "unavailable" as const,
        lastCheckedAt: checkedAt,
        lastHeartbeatAt: null,
        metadata: {
          binary: spec.binary,
          durationMs: pathCheck.durationMs,
          stderrSummary: pathCheck.stderr.slice(0, 240)
        }
      };
      this.logger.info({
        source: "runtime",
        eventName: "runtime.check.unavailable",
        message: "Runtime CLI not found",
        correlationId,
        metadata: unavailable
      });
      return unavailable;
    }

    const versionCheck = await this.executor(cliPath, spec.versionArgs, this.commandTimeoutMs);
    const versionText = versionCheck.stdout.trim().split(/\r?\n/)[0] || null;
    const health = versionCheck.exitCode === 0 && !versionCheck.timedOut ? "available" : "error";
    const record: RuntimeRecord = {
      id: `runtime-${spec.providerType}`,
      providerType: spec.providerType,
      name: spec.name,
      cliPath,
      version: versionText,
      health,
      lastCheckedAt: checkedAt,
      lastHeartbeatAt: null,
      metadata: {
        binary: spec.binary,
        versionArgs: spec.versionArgs,
        durationMs: versionCheck.durationMs,
        timedOut: versionCheck.timedOut,
        stderrSummary: versionCheck.stderr.slice(0, 240)
      }
    };

    this.logger.info({
      source: "runtime",
      eventName: "runtime.check.complete",
      message: "Runtime CLI check completed",
      correlationId,
      metadata: redactValue(record)
    });
    return record;
  }

  private upsert(record: RuntimeRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO runtimes (
          id, provider_type, name, cli_path, version, health,
          last_checked_at, last_heartbeat_at, metadata_json
        ) VALUES (
          @id, @providerType, @name, @cliPath, @version, @health,
          @lastCheckedAt, @lastHeartbeatAt, @metadataJson
        )
        ON CONFLICT(provider_type) DO UPDATE SET
          name = excluded.name,
          cli_path = excluded.cli_path,
          version = excluded.version,
          health = excluded.health,
          last_checked_at = excluded.last_checked_at,
          last_heartbeat_at = excluded.last_heartbeat_at,
          metadata_json = excluded.metadata_json
      `
      )
      .run({
        id: record.id,
        providerType: record.providerType,
        name: record.name,
        cliPath: record.cliPath,
        version: record.version,
        health: record.health,
        lastCheckedAt: record.lastCheckedAt,
        lastHeartbeatAt: record.lastHeartbeatAt,
        metadataJson: JSON.stringify(record.metadata)
      });
  }
}
