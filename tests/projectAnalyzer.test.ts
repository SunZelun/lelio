import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeProjectDirectory, detectPackageManager } from "../src/main/projects/projectAnalyzer";

describe("projectAnalyzer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lelio-analyzer-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects npm project from package.json and lock file", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "my-app",
        description: "A test project",
        scripts: { test: "vitest run", build: "tsc" },
        dependencies: { react: "^18.0.0" }
      })
    );
    fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "{}");

    const result = await analyzeProjectDirectory(tmpDir);

    expect(result.name).toBe("my-app");
    expect(result.packageManager).toBe("npm");
    expect(result.testCommand).toBe("npm test");
    expect(result.buildCommand).toBe("npm run build");
    expect(result.description).toBe("A test project");
    expect(result.framework).toBe("React");
    expect(result.languages).toContain("JavaScript/TypeScript");
  });

  it("detects Rust project from Cargo.toml", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "Cargo.toml"),
      '[package]\nname = "my-crate"\nversion = "0.1.0"\n'
    );

    const result = await analyzeProjectDirectory(tmpDir);

    expect(result.name).toBe("my-crate");
    expect(result.testCommand).toBe("cargo test");
    expect(result.buildCommand).toBe("cargo build");
    expect(result.languages).toContain("Rust");
  });

  it("detects Go project from go.mod", async () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module github.com/user/myservice\n\ngo 1.21\n");

    const result = await analyzeProjectDirectory(tmpDir);

    expect(result.name).toBe("myservice");
    expect(result.testCommand).toBe("go test ./...");
    expect(result.buildCommand).toBe("go build ./...");
    expect(result.languages).toContain("Go");
  });

  it("detects Python project from pyproject.toml", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "pyproject.toml"),
      '[project]\nname = "my-python-lib"\nversion = "1.0.0"\n'
    );

    const result = await analyzeProjectDirectory(tmpDir);

    expect(result.name).toBe("my-python-lib");
    expect(result.testCommand).toBe("pytest");
    expect(result.languages).toContain("Python");
  });

  it("falls back to folder name when no config files exist", async () => {
    const result = await analyzeProjectDirectory(tmpDir);

    expect(result.name).toBe(path.basename(tmpDir));
    expect(result.packageManager).toBeNull();
    expect(result.testCommand).toBeNull();
    expect(result.buildCommand).toBeNull();
    expect(result.languages).toEqual([]);
  });

  it("reads project name from README heading as fallback", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# My Cool Project\n\nSome description.\n");

    const result = await analyzeProjectDirectory(tmpDir);

    expect(result.name).toBe("My Cool Project");
  });

  it("detects Makefile test/build targets", async () => {
    fs.writeFileSync(path.join(tmpDir, "Makefile"), "test:\n\techo test\n\nbuild:\n\techo build\n");

    const result = await analyzeProjectDirectory(tmpDir);

    expect(result.testCommand).toBe("make test");
    expect(result.buildCommand).toBe("make build");
  });

  it("detects pnpm package manager", async () => {
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: 5\n");

    const pm = await detectPackageManager(tmpDir);

    expect(pm).toBe("pnpm");
  });

  it("detects framework from dependencies", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "next-app",
        scripts: { build: "next build" },
        dependencies: { next: "^14.0.0", react: "^18.0.0" }
      })
    );

    const result = await analyzeProjectDirectory(tmpDir);

    expect(result.framework).toBe("Next.js");
  });
});
