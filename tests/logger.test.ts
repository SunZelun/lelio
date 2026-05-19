import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlLogger } from "../src/main/logging/logger";

describe("JsonlLogger", () => {
  it("writes JSONL with correlation IDs and redacted metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-logger-"));
    const logger = new JsonlLogger(root, "debug", 14);
    const correlationId = logger.info({
      source: "test",
      eventName: "logger.write",
      message: "write test",
      metadata: {
        token: "secret-token",
        nested: "Bearer abc.def"
      }
    });

    const line = fs.readFileSync(logger.currentLogPath(), "utf8").trim();
    const parsed = JSON.parse(line) as { correlationId: string; metadata: Record<string, unknown> };
    expect(parsed.correlationId).toBe(correlationId);
    expect(parsed.metadata.token).toBe("[REDACTED]");
    expect(parsed.metadata.nested).toBe("Bearer [REDACTED]");
  });
});
