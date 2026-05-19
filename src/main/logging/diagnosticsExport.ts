import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseHealth, DiagnosticsExport, RuntimeRecord } from "../../shared/schemas";
import type { JsonlLogger } from "./logger";
import type { LelioPaths } from "../paths";
import type { SettingsStore } from "../settings/settingsStore";
import { redactValue } from "./redaction";

export type DiagnosticsExportInput = {
  correlationId: string;
  paths: LelioPaths;
  settingsStore: SettingsStore;
  logger: JsonlLogger;
  getDatabaseHealth: () => DatabaseHealth;
  getRuntimeInventory: () => RuntimeRecord[];
  destination?: string | null;
};

export async function exportDiagnostics(input: DiagnosticsExportInput): Promise<DiagnosticsExport> {
  const createdAt = new Date().toISOString();
  const safeTimestamp = createdAt.replace(/[:.]/g, "-");
  const root = input.destination ?? input.paths.desktopRoot;
  const exportPath = path.join(root, `Lelio-Diagnostics-${safeTimestamp}`);
  const includedFiles: string[] = [];

  input.logger.info({
    source: "diagnostics",
    eventName: "diagnostics.export.start",
    message: "Starting diagnostics export",
    correlationId: input.correlationId,
    metadata: { exportPath }
  });

  await fs.mkdir(exportPath, { recursive: true });
  await writeFile(exportPath, "README.txt", diagnosticsReadme(input.correlationId), includedFiles);
  await writeFile(
    exportPath,
    "settings-summary.json",
    JSON.stringify(redactValue(input.settingsStore.summary()), null, 2),
    includedFiles
  );
  await writeFile(
    exportPath,
    "database-health.json",
    JSON.stringify(redactValue(input.getDatabaseHealth()), null, 2),
    includedFiles
  );
  await writeFile(
    exportPath,
    "runtime-inventory.json",
    JSON.stringify(redactValue(input.getRuntimeInventory()), null, 2),
    includedFiles
  );

  const logsDir = path.join(exportPath, "logs");
  await fs.mkdir(logsDir, { recursive: true });
  const copiedLogs = await copyRecentRedactedLogs(input.paths.logsRoot, logsDir);
  includedFiles.push(...copiedLogs.map((fileName) => path.join("logs", fileName)));

  input.logger.info({
    source: "diagnostics",
    eventName: "diagnostics.export.complete",
    message: "Diagnostics export completed",
    correlationId: input.correlationId,
    metadata: { exportPath, includedFiles }
  });

  return { exportPath, createdAt, includedFiles };
}

function diagnosticsReadme(correlationId: string): string {
  return [
    "Lelio Diagnostics Export",
    "",
    "This Phase 0 export is a redacted folder stub for local troubleshooting.",
    `Export correlation ID: ${correlationId}`,
    "",
    "Use the correlation ID from a user-visible error to search JSONL logs.",
    "This bundle excludes API keys, auth tokens, keychain values, full environment dumps, and repo contents.",
    ""
  ].join("\n");
}

async function writeFile(root: string, relativePath: string, content: string, includedFiles: string[]): Promise<void> {
  await fs.writeFile(path.join(root, relativePath), `${content.trimEnd()}\n`, "utf8");
  includedFiles.push(relativePath);
}

async function copyRecentRedactedLogs(logsRoot: string, destination: string): Promise<string[]> {
  let fileNames: string[];
  try {
    fileNames = await fs.readdir(logsRoot);
  } catch {
    return [];
  }

  const recentLogs = fileNames
    .filter((fileName) => /^lelio-\d{4}-\d{2}-\d{2}\.jsonl$/.test(fileName))
    .sort()
    .slice(-3);

  const copied: string[] = [];
  for (const fileName of recentLogs) {
    const sourcePath = path.join(logsRoot, fileName);
    const targetPath = path.join(destination, fileName);
    const lines = (await fs.readFile(sourcePath, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.stringify(redactValue(JSON.parse(line)));
        } catch {
          return JSON.stringify(redactValue({ raw: line }));
        }
      });
    await fs.writeFile(targetPath, `${lines.join("\n")}\n`, "utf8");
    copied.push(fileName);
  }

  return copied;
}
