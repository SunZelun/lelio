import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type LelioPaths = {
  appDataRoot: string;
  databasePath: string;
  settingsPath: string;
  worktreeRoot: string;
  logsRoot: string;
  desktopRoot: string;
};

export function getLelioPaths(homeDir = os.homedir()): LelioPaths {
  const appDataRoot = path.join(homeDir, "Library", "Application Support", "Lelio");
  return {
    appDataRoot,
    databasePath: path.join(appDataRoot, "lelio.sqlite"),
    settingsPath: path.join(appDataRoot, "settings.json"),
    worktreeRoot: path.join(appDataRoot, "worktrees"),
    logsRoot: path.join(homeDir, "Library", "Logs", "Lelio"),
    desktopRoot: path.join(homeDir, "Desktop")
  };
}

export function ensureLelioDirectories(paths: LelioPaths): void {
  fs.mkdirSync(paths.appDataRoot, { recursive: true });
  fs.mkdirSync(paths.worktreeRoot, { recursive: true });
  fs.mkdirSync(paths.logsRoot, { recursive: true });
}
