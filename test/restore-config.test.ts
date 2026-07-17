import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { dirname, isAbsolute, join } from "path";
import { restoreConfigFromBase } from "../src/github/operations/restore-config";

const KIMI_PR_EXCLUDE_PATTERN = "/.kimi-pr/";

describe("restoreConfigFromBase", () => {
  let originalCwd: string;
  let tempDir = "";
  let repoDir: string;
  let remoteDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join("/tmp", "restore-config-"));
    repoDir = join(tempDir, "repo");
    remoteDir = join(tempDir, "origin.git");

    execFileSync("git", ["init", "--bare", remoteDir], { stdio: "pipe" });
    execFileSync("git", ["init", repoDir], { stdio: "pipe" });
    git(["checkout", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test User"]);

    writeRepoFile("AGENTS.md", "base agent instructions\n");
    writeRepoFile(".kimi-code/local.toml", 'source = "base"\n');
    writeRepoFile("src/index.ts", "export const base = true;\n");

    git(["add", "AGENTS.md", ".kimi-code/local.toml", "src/index.ts"]);
    git(["commit", "-m", "base config"]);
    git(["remote", "add", "origin", remoteDir]);
    git(["push", "-u", "origin", "main"]);

    git(["checkout", "-b", "pr"]);
    writeRepoFile("AGENTS.md", "pr agent instructions\n");
    writeRepoFile(".kimi-code/local.toml", 'source = "pr"\n');
    git(["add", "AGENTS.md", ".kimi-code/local.toml"]);
    git(["commit", "-m", "pr config"]);

    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("preserves PR sensitive files while excluding .kimi-pr from broad staging", () => {
    const gitignoreExistedBefore = existsRepoFile(".gitignore");
    const gitignoreContentsBefore = gitignoreExistedBefore
      ? readRepoFile(".gitignore")
      : "";

    restoreConfigFromBase("main");

    expect(readRepoFile(".kimi-pr/AGENTS.md")).toBe("pr agent instructions\n");
    expect(readRepoFile(".kimi-pr/.kimi-code/local.toml")).toBe(
      'source = "pr"\n',
    );
    expect(readRepoFile("AGENTS.md")).toBe("base agent instructions\n");
    expect(readRepoFile(".kimi-code/local.toml")).toBe('source = "base"\n');
    expect(git(["check-ignore", ".kimi-pr/AGENTS.md"]).trim()).toBe(
      ".kimi-pr/AGENTS.md",
    );
    expect(countKimiPrExcludeEntries()).toBe(1);

    restoreConfigFromBase("main");

    expect(countKimiPrExcludeEntries()).toBe(1);
    expect(existsRepoFile(".gitignore")).toBe(gitignoreExistedBefore);
    if (gitignoreExistedBefore) {
      expect(readRepoFile(".gitignore")).toBe(gitignoreContentsBefore);
    }

    writeRepoFile("src/fix.ts", "export const fix = true;\n");
    git(["add", "-A"]);

    const stagedFiles = git(["diff", "--cached", "--name-only"])
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    expect(stagedFiles).toContain("src/fix.ts");
    expect(stagedFiles.some((file) => file.startsWith(".kimi-pr/"))).toBe(
      false,
    );

    git(["commit", "-m", "apply fix"]);

    const committedFiles = git(["show", "--name-only", "--format=", "HEAD"])
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    expect(committedFiles).toContain("src/fix.ts");
    expect(committedFiles.some((file) => file.startsWith(".kimi-pr/"))).toBe(
      false,
    );
    expect(existsRepoFile(".gitignore")).toBe(gitignoreExistedBefore);
    if (gitignoreExistedBefore) {
      expect(readRepoFile(".gitignore")).toBe(gitignoreContentsBefore);
    }
  });

  test("restores symlinked AGENTS.md paths from the PR base branch", () => {
    setupSymlinkedMainBranch();

    git(["checkout", "pr"]);
    writeRepoFile(".kimi-code/local.toml", 'source = "pr-with-symlinks"\n');
    git(["add", ".kimi-code/local.toml"]);
    git(["commit", "-m", "pr updates local config"]);

    restoreConfigFromBase("main");

    expect(lstatRepoFile("AGENTS.md").isSymbolicLink()).toBe(true);
    expect(lstatRepoFile(".kimi-code/AGENTS.md").isSymbolicLink()).toBe(true);
    expect(readRepoFile("AGENTS.md").trim()).toBe("shared agent instructions");
    expect(readRepoFile(".kimi-code/AGENTS.md").trim()).toBe(
      "shared agent instructions",
    );
    expect(readRepoFile(".kimi-code/local.toml")).toBe('source = "base"\n');
  });

  test("snapshots symlinked sensitive paths even when the PR head target is missing", () => {
    setupSymlinkedMainBranch();

    git(["checkout", "pr"]);
    rmSync(join(repoDir, "kimi-instructions.md"), { force: true });
    git(["add", "-A"]);
    git(["commit", "-m", "pr deletes shared instructions file"]);

    restoreConfigFromBase("main");

    expect(
      lstatRepoFile(".kimi-pr/.kimi-code/AGENTS.md").isSymbolicLink(),
    ).toBe(true);
    expect(readRepoFile(".kimi-code/local.toml")).toBe('source = "base"\n');
  });

  test("does not modify an existing .gitignore", () => {
    writeRepoFile(".gitignore", "node_modules\n");
    git(["add", ".gitignore"]);
    git(["commit", "-m", "add gitignore"]);

    const gitignoreBefore = readRepoFile(".gitignore");

    restoreConfigFromBase("main");

    expect(readRepoFile(".gitignore")).toBe(gitignoreBefore);
    expect(countKimiPrExcludeEntries()).toBe(1);
  });

  function git(args: string[]): string {
    return execFileSync("git", args, {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  function writeRepoFile(path: string, contents: string): void {
    const fullPath = join(repoDir, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, contents);
  }

  function readRepoFile(path: string): string {
    return readFileSync(join(repoDir, path), "utf8");
  }

  function existsRepoFile(path: string): boolean {
    return existsSync(join(repoDir, path));
  }

  function symlinkRepoFile(path: string, target: string): void {
    const fullPath = join(repoDir, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    symlinkSync(target, fullPath);
  }

  function lstatRepoFile(path: string) {
    return lstatSync(join(repoDir, path));
  }

  function setupSymlinkedMainBranch(): void {
    git(["checkout", "main"]);
    rmSync(join(repoDir, "AGENTS.md"), { force: true });
    writeRepoFile("kimi-instructions.md", "shared agent instructions\n");
    symlinkRepoFile("AGENTS.md", "kimi-instructions.md");
    symlinkRepoFile(".kimi-code/AGENTS.md", "../kimi-instructions.md");
    git(["add", "kimi-instructions.md", "AGENTS.md", ".kimi-code/AGENTS.md"]);
    git(["commit", "-m", "add symlinked agent files"]);
    git(["push", "origin", "main"]);
    git(["branch", "-D", "pr"]);
    git(["checkout", "-b", "pr"]);
  }

  function countKimiPrExcludeEntries(): number {
    return readFileSync(getExcludePath(), "utf8")
      .split(/\r?\n/)
      .filter((line) => line === KIMI_PR_EXCLUDE_PATTERN).length;
  }

  function getExcludePath(): string {
    const gitPath = git(["rev-parse", "--git-path", "info/exclude"]).trim();
    return isAbsolute(gitPath) ? gitPath : join(repoDir, gitPath);
  }
});
