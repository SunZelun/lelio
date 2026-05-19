import { execFile } from "node:child_process";
import type { CommandResult, GitChangedFilesSummary } from "../../shared/types";

export type GitSnapshot = {
  branch: string | null;
  dirty: boolean | null;
  status: "clean" | "dirty" | "not-git" | "error";
  changedFilesCount: number;
  checkedAt: string;
  stderrSummary: string | null;
};

export type GitCommandExecutor = (
  command: string,
  args: string[],
  timeoutMs: number
) => Promise<CommandResult>;

export function defaultGitCommandExecutor(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: timeoutMs, maxBuffer: 96 * 1024 }, (error, stdout, stderr) => {
      const maybeError = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      resolve({
        command,
        args,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: typeof maybeError?.code === "number" ? maybeError.code : maybeError ? 1 : 0,
        timedOut: Boolean(maybeError?.killed),
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

export async function getGitSnapshot(
  projectPath: string,
  executor: GitCommandExecutor = defaultGitCommandExecutor,
  timeoutMs = 2000
): Promise<GitSnapshot> {
  const checkedAt = new Date().toISOString();
  const result = await executor("git", ["-C", projectPath, "status", "--short", "--branch"], timeoutMs);

  if (result.exitCode !== 0 || result.timedOut) {
    const stderrSummary = result.stderr.slice(0, 240) || null;
    const notGit = /not a git repository|cannot change to|No such file/i.test(result.stderr);
    return {
      branch: null,
      dirty: null,
      status: notGit ? "not-git" : "error",
      changedFilesCount: 0,
      checkedAt,
      stderrSummary
    };
  }

  return parseGitStatusOutput(result.stdout, checkedAt, result.stderr.slice(0, 240) || null);
}

export async function getGitChangedFilesSummary(
  projectPath: string,
  executor: GitCommandExecutor = defaultGitCommandExecutor,
  timeoutMs = 2000,
  limit = 20
): Promise<GitChangedFilesSummary> {
  const checkedAt = new Date().toISOString();
  const result = await executor("git", ["-C", projectPath, "status", "--short", "--branch", "--untracked-files=normal"], timeoutMs);

  if (result.exitCode !== 0 || result.timedOut) {
    const error = result.stderr.slice(0, 240) || (result.timedOut ? "git status timed out" : null);
    const notGit = /not a git repository|cannot change to|No such file/i.test(result.stderr);
    return {
      branch: null,
      status: notGit ? "not-git" : "error",
      checkedAt,
      totalCount: 0,
      files: [],
      truncated: false,
      error
    };
  }

  return parseGitChangedFilesOutput(result.stdout, checkedAt, result.stderr.slice(0, 240) || null, limit);
}

export function parseGitStatusOutput(stdout: string, checkedAt = new Date().toISOString(), stderrSummary: string | null = null): GitSnapshot {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## "));
  const changedFilesCount = lines.filter((line) => !line.startsWith("## ")).length;
  const branch = parseBranch(branchLine);

  return {
    branch,
    dirty: changedFilesCount > 0,
    status: changedFilesCount > 0 ? "dirty" : "clean",
    changedFilesCount,
    checkedAt,
    stderrSummary
  };
}

export function parseGitChangedFilesOutput(
  stdout: string,
  checkedAt = new Date().toISOString(),
  error: string | null = null,
  limit = 20
): GitChangedFilesSummary {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## "));
  const entries = lines.filter((line) => !line.startsWith("## "));
  const files = entries.slice(0, limit).map(parseChangedFileLine);

  return {
    branch: parseBranch(branchLine),
    status: entries.length > 0 ? "dirty" : "clean",
    checkedAt,
    totalCount: entries.length,
    files,
    truncated: entries.length > limit,
    error
  };
}

function parseChangedFileLine(line: string): { status: string; path: string } {
  const status = line.slice(0, 2).trim() || line.slice(0, 2);
  const filePath = line.slice(3).trim();
  return {
    status,
    path: filePath || line.trim()
  };
}

function parseBranch(branchLine: string | undefined): string | null {
  if (!branchLine) {
    return null;
  }

  const withoutPrefix = branchLine.replace(/^##\s+/, "");
  const branch = withoutPrefix.split("...")[0]?.trim();
  return branch && branch !== "HEAD (no branch)" ? branch : null;
}
