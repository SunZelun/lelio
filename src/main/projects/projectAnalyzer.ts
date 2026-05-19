import fs from "node:fs/promises";
import path from "node:path";

export type ProjectAnalysis = {
  name: string | null;
  packageManager: string | null;
  testCommand: string | null;
  buildCommand: string | null;
  description: string | null;
  languages: string[];
  framework: string | null;
};

const MAX_FILE_BYTES = 8192;

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) {
      return stats.isFile() ? (await fs.readFile(filePath, "utf-8")).slice(0, MAX_FILE_BYTES) : null;
    }
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function safeExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function detectPackageManager(projectPath: string): Promise<string | null> {
  const candidates: Array<[string, string]> = [
    ["package-lock.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"]
  ];

  return (async () => {
    for (const [fileName, pm] of candidates) {
      if (await safeExists(path.join(projectPath, fileName))) {
        return pm;
      }
    }
    return null;
  })();
}

type PackageJson = {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

async function analyzePackageJson(projectPath: string): Promise<{
  name: string | null;
  description: string | null;
  testCommand: string | null;
  buildCommand: string | null;
  framework: string | null;
}> {
  const content = await safeReadFile(path.join(projectPath, "package.json"));
  if (!content) {
    return { name: null, description: null, testCommand: null, buildCommand: null, framework: null };
  }

  try {
    const pkg: PackageJson = JSON.parse(content);
    const scripts = pkg.scripts ?? {};
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    let framework: string | null = null;
    if (allDeps["next"]) framework = "Next.js";
    else if (allDeps["nuxt"]) framework = "Nuxt";
    else if (allDeps["@angular/core"]) framework = "Angular";
    else if (allDeps["svelte"]) framework = "Svelte";
    else if (allDeps["vue"]) framework = "Vue";
    else if (allDeps["react"]) framework = "React";
    else if (allDeps["express"]) framework = "Express";
    else if (allDeps["fastify"]) framework = "Fastify";
    else if (allDeps["electron"]) framework = "Electron";

    return {
      name: pkg.name ?? null,
      description: pkg.description ?? null,
      testCommand: scripts["test"] ? "npm test" : null,
      buildCommand: scripts["build"] ? "npm run build" : null,
      framework
    };
  } catch {
    return { name: null, description: null, testCommand: null, buildCommand: null, framework: null };
  }
}

async function analyzeCargoToml(projectPath: string): Promise<{
  name: string | null;
  testCommand: string | null;
  buildCommand: string | null;
}> {
  const content = await safeReadFile(path.join(projectPath, "Cargo.toml"));
  if (!content) {
    return { name: null, testCommand: null, buildCommand: null };
  }

  const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
  return {
    name: nameMatch?.[1] ?? null,
    testCommand: "cargo test",
    buildCommand: "cargo build"
  };
}

async function analyzeGoMod(projectPath: string): Promise<{
  name: string | null;
  testCommand: string | null;
  buildCommand: string | null;
}> {
  const content = await safeReadFile(path.join(projectPath, "go.mod"));
  if (!content) {
    return { name: null, testCommand: null, buildCommand: null };
  }

  const moduleMatch = content.match(/^module\s+(\S+)/m);
  const modulePath = moduleMatch?.[1] ?? null;
  const name = modulePath ? modulePath.split("/").pop() ?? modulePath : null;
  return {
    name,
    testCommand: "go test ./...",
    buildCommand: "go build ./..."
  };
}

async function analyzePyProject(projectPath: string): Promise<{
  name: string | null;
  testCommand: string | null;
  buildCommand: string | null;
}> {
  const content = await safeReadFile(path.join(projectPath, "pyproject.toml"));
  if (!content) {
    return { name: null, testCommand: null, buildCommand: null };
  }

  const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
  return {
    name: nameMatch?.[1] ?? null,
    testCommand: "pytest",
    buildCommand: null
  };
}

async function analyzeMakefile(projectPath: string): Promise<{
  testCommand: string | null;
  buildCommand: string | null;
}> {
  const content = await safeReadFile(path.join(projectPath, "Makefile"));
  if (!content) {
    return { testCommand: null, buildCommand: null };
  }

  const targets = [...content.matchAll(/^([a-zA-Z_][\w-]*):/gm)].map((m) => m[1]);
  return {
    testCommand: targets.includes("test") ? "make test" : null,
    buildCommand: targets.includes("build") ? "make build" : null
  };
}

async function readReadmeName(projectPath: string): Promise<string | null> {
  for (const candidate of ["README.md", "readme.md", "README.rst", "README.txt", "README"]) {
    const content = await safeReadFile(path.join(projectPath, candidate));
    if (content) {
      const heading = content.match(/^#\s+(.+)/m);
      if (heading) {
        return heading[1].trim().slice(0, 80);
      }
      const firstLine = content.trim().split("\n")[0]?.trim();
      if (firstLine && firstLine.length <= 80) {
        return firstLine;
      }
    }
  }
  return null;
}

function detectLanguages(
  hasPackageJson: boolean,
  hasCargoToml: boolean,
  hasGoMod: boolean,
  hasPyProject: boolean
): string[] {
  const langs: string[] = [];
  if (hasPackageJson) langs.push("JavaScript/TypeScript");
  if (hasCargoToml) langs.push("Rust");
  if (hasGoMod) langs.push("Go");
  if (hasPyProject) langs.push("Python");
  return langs;
}

export async function analyzeProjectDirectory(projectPath: string): Promise<ProjectAnalysis> {
  const [packageJson, cargo, goMod, pyProject, makefile, readmeName, pm] = await Promise.all([
    analyzePackageJson(projectPath),
    analyzeCargoToml(projectPath),
    analyzeGoMod(projectPath),
    analyzePyProject(projectPath),
    analyzeMakefile(projectPath),
    readReadmeName(projectPath),
    detectPackageManager(projectPath)
  ]);

  // Priority: package.json > Cargo.toml > go.mod > pyproject.toml > Makefile > README
  const name =
    packageJson.name ?? cargo.name ?? goMod.name ?? pyProject.name ?? readmeName ?? path.basename(projectPath);

  const testCommand =
    packageJson.testCommand ?? cargo.testCommand ?? goMod.testCommand ?? pyProject.testCommand ?? makefile.testCommand;

  const buildCommand =
    packageJson.buildCommand ?? cargo.buildCommand ?? goMod.buildCommand ?? pyProject.buildCommand ?? makefile.buildCommand;

  const description = packageJson.description ?? null;
  const framework = packageJson.framework ?? null;

  const hasPackageJson = packageJson.name !== null || packageJson.testCommand !== null;
  const languages = detectLanguages(hasPackageJson, cargo.name !== null, goMod.name !== null, pyProject.name !== null);

  return {
    name,
    packageManager: pm,
    testCommand,
    buildCommand,
    description,
    languages,
    framework
  };
}
