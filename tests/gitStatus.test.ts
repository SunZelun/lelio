import { describe, expect, it } from "vitest";
import {
  getGitChangedFilesSummary,
  getGitSnapshot,
  parseGitChangedFilesOutput,
  parseGitStatusOutput,
  type GitCommandExecutor
} from "../src/main/projects/gitStatus";

describe("git status snapshots", () => {
  it("parses clean and dirty git status output", () => {
    const clean = parseGitStatusOutput("## main...origin/main\n", "2026-05-19T00:00:00.000Z");
    expect(clean).toMatchObject({
      branch: "main",
      dirty: false,
      status: "clean",
      changedFilesCount: 0
    });

    const dirty = parseGitStatusOutput("## feature/demo\n M src/app.ts\n?? tests/app.test.ts\n", "2026-05-19T00:00:00.000Z");
    expect(dirty).toMatchObject({
      branch: "feature/demo",
      dirty: true,
      status: "dirty",
      changedFilesCount: 2
    });
  });

  it("returns not-git without throwing for non-repository paths", async () => {
    const executor: GitCommandExecutor = async (command, args) => ({
      command,
      args,
      stdout: "",
      stderr: "fatal: not a git repository",
      exitCode: 128,
      timedOut: false,
      durationMs: 4
    });

    await expect(getGitSnapshot("/tmp/nope", executor, 25)).resolves.toMatchObject({
      branch: null,
      dirty: null,
      status: "not-git",
      changedFilesCount: 0
    });
  });

  it("summarizes changed files with bounded entries", async () => {
    const summary = parseGitChangedFilesOutput(
      "## feature/demo\n M src/app.ts\nA  src/new.ts\nR  old.ts -> new.ts\n?? tmp/\n",
      "2026-05-19T00:00:00.000Z",
      null,
      2
    );

    expect(summary).toMatchObject({
      branch: "feature/demo",
      status: "dirty",
      totalCount: 4,
      truncated: true,
      files: [
        { status: "M", path: "src/app.ts" },
        { status: "A", path: "src/new.ts" }
      ]
    });
  });

  it("uses bounded git status for changed file summaries", async () => {
    const executor: GitCommandExecutor = async (command, args) => ({
      command,
      args,
      stdout: "## main\n?? notes.md\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      durationMs: 3
    });

    await expect(getGitChangedFilesSummary("/tmp/repo", executor, 25, 5)).resolves.toMatchObject({
      branch: "main",
      status: "dirty",
      totalCount: 1,
      files: [{ status: "??", path: "notes.md" }]
    });
  });
});
