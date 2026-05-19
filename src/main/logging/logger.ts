import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LogLevel } from "../../shared/schemas";
import { redactError, redactValue } from "./redaction";

export type LogEventInput = {
  level: LogLevel;
  source: string;
  eventName: string;
  message: string;
  correlationId?: string;
  metadata?: unknown;
};

export type LogEvent = Required<Omit<LogEventInput, "metadata">> & {
  timestamp: string;
  metadata: unknown;
};

export type LogEventWriter = (event: LogEvent) => void;

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createCorrelationId(): string {
  return crypto.randomUUID();
}

export class JsonlLogger {
  private writer: LogEventWriter | undefined;

  constructor(
    private readonly logsRoot: string,
    private logLevel: LogLevel = "info",
    private retentionDays = 14
  ) {
    fs.mkdirSync(logsRoot, { recursive: true });
    this.cleanupOldLogs();
  }

  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  setRetentionDays(days: number): void {
    this.retentionDays = days;
  }

  setEventWriter(writer: LogEventWriter): void {
    this.writer = writer;
  }

  debug(input: Omit<LogEventInput, "level">): string {
    return this.log({ ...input, level: "debug" });
  }

  info(input: Omit<LogEventInput, "level">): string {
    return this.log({ ...input, level: "info" });
  }

  warn(input: Omit<LogEventInput, "level">): string {
    return this.log({ ...input, level: "warn" });
  }

  error(input: Omit<LogEventInput, "level">): string {
    return this.log({ ...input, level: "error" });
  }

  log(input: LogEventInput): string {
    const correlationId = input.correlationId ?? createCorrelationId();
    if (LEVEL_WEIGHTS[input.level] < LEVEL_WEIGHTS[this.logLevel]) {
      return correlationId;
    }

    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      level: input.level,
      source: input.source,
      eventName: input.eventName,
      message: redactValue(input.message) as string,
      correlationId,
      metadata: redactValue(input.metadata ?? {})
    };

    fs.appendFileSync(this.currentLogPath(), `${JSON.stringify(event)}\n`, "utf8");

    if (this.writer) {
      try {
        this.writer(event);
      } catch {
        // Logging must never break the user action that produced the event.
      }
    }

    return correlationId;
  }

  exception(input: Omit<LogEventInput, "level" | "metadata"> & { error: unknown; metadata?: unknown }): string {
    return this.error({
      source: input.source,
      eventName: input.eventName,
      message: input.message,
      correlationId: input.correlationId,
      metadata: {
        ...((input.metadata as Record<string, unknown> | undefined) ?? {}),
        error: redactError(input.error)
      }
    });
  }

  currentLogPath(date = new Date()): string {
    const day = date.toISOString().slice(0, 10);
    return path.join(this.logsRoot, `lelio-${day}.jsonl`);
  }

  cleanupOldLogs(referenceDate = new Date()): void {
    const cutoff = referenceDate.getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const fileName of fs.readdirSync(this.logsRoot)) {
      const match = /^lelio-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(fileName);
      if (!match) {
        continue;
      }

      const logTime = new Date(`${match[1]}T00:00:00.000Z`).getTime();
      if (Number.isFinite(logTime) && logTime < cutoff) {
        fs.rmSync(path.join(this.logsRoot, fileName), { force: true });
      }
    }
  }
}
