import { execFileSync } from "child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "fs";
import { dirname } from "path";

// Paths that are both PR-controllable and read from cwd at CLI startup.
//
// Threat model per path:
//   .kimi-code/  — kimi's project-level config directory (mcp.json, local.toml).
//                  mcp.json can define arbitrary stdio MCP server commands that
//                  run before any permission gating; local.toml can tamper with
//                  [[permission.rules]] and weaken the action's default denies.
//                  Both are RCE / privilege-escalation surfaces, so the whole
//                  tree is restored from the base branch.
//   AGENTS.md    — kimi reads this as project instructions. A PR can inject
//                  instructions that hijack the agent (prompt injection), the
//                  same surface CLAUDE.md had for the upstream action.
//   .mcp.json    — cwd-level MCP config. kimi itself reads MCP config from
//                  $KIMI_CODE_HOME/mcp.json, but any tool in the chain that
//                  honors the cwd convention would execute attacker-controlled
//                  servers; restored defensively (same as upstream).
//   .gitmodules  — git-level threat, independent of the CLI: fetching with
//                  recurse-submodules can pull attacker repos and block on
//                  credential prompts (CI hang). Kept from upstream verbatim.
//   .ripgreprc   — ripgrep config can inject dangerous flags (e.g. a --pre
//                  processor command) if the agent's search tooling shells out
//                  to rg. Kept from upstream verbatim.
//   .husky       — git hooks directory; hook scripts run when the agent invokes
//                  git commands and hooks are active. Kept from upstream verbatim.
//
// Deliberately excluded:
//   .git/        — not tracked by git; PR commits cannot place files there.
//                  Restoring it would also undo the PR checkout entirely.
//   .gitconfig   — git reads ~/.gitconfig and .git/config, never cwd/.gitconfig.
//   .bashrc etc. — shells source these from $HOME; checkout cannot reach $HOME.
//   .vscode/.idea— IDE config; nothing in the CLI's startup path reads them.
const SENSITIVE_PATHS = [
  ".kimi-code",
  "AGENTS.md",
  ".mcp.json",
  ".gitmodules",
  ".ripgreprc",
  ".husky",
];

const KIMI_PR_EXCLUDE_PATTERN = "/.kimi-pr/";

function snapshotSensitivePath(src: string, dest: string): void {
  try {
    cpSync(src, dest, { recursive: true, dereference: true });
  } catch (error) {
    // Symlinks whose targets are absent on the PR head (e.g. `.kimi-code/AGENTS.md`
    // -> `../AGENTS.shared.md` when the PR deleted the target) make dereferenced
    // copies throw ENOENT. Preserve the symlink for the review snapshot instead.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      cpSync(src, dest, { recursive: true });
      return;
    }
    throw error;
  }
}

function ensureKimiPrExcludedFromGit(): void {
  const excludePath = execFileSync(
    "git",
    ["rev-parse", "--git-path", "info/exclude"],
    { encoding: "utf8" },
  ).trim();

  const excludeContents = existsSync(excludePath)
    ? readFileSync(excludePath, "utf8")
    : "";

  if (excludeContents.split(/\r?\n/).includes(KIMI_PR_EXCLUDE_PATTERN)) {
    return;
  }

  mkdirSync(dirname(excludePath), { recursive: true });

  const prefix =
    excludeContents.length === 0 || excludeContents.endsWith("\n") ? "" : "\n";
  appendFileSync(excludePath, `${prefix}${KIMI_PR_EXCLUDE_PATTERN}\n`);
}

/**
 * Restores security-sensitive config paths from the PR base branch.
 *
 * kimi's non-interactive mode trusts cwd: it reads `.kimi-code/` (mcp.json,
 * local.toml) and `AGENTS.md` from the working directory and acts on them
 * before any tool-permission gating — starting arbitrary MCP server commands
 * and applying attacker-written permission rules. When this action checks out
 * a PR head, all of these are attacker-controlled.
 *
 * Rather than enumerate every dangerous key, this replaces the entire
 * `.kimi-code/` tree and the other sensitive paths with the versions from the
 * PR base branch, which a maintainer has reviewed and merged. Paths absent on
 * base are deleted.
 *
 * Known limitation: if a PR legitimately modifies `.kimi-code/` and the CLI
 * later commits with `git add -A`, the revert will be included in that commit.
 * This is a narrow UX tradeoff for closing the RCE surface.
 *
 * @param baseBranch - PR base branch name. Must be pre-validated (branch.ts
 *   calls validateBranchName on it before returning).
 */
export function restoreConfigFromBase(baseBranch: string): void {
  console.log(
    `Restoring ${SENSITIVE_PATHS.join(", ")} from origin/${baseBranch} (PR head is untrusted)`,
  );

  // Snapshot every PR-authored sensitive path into .kimi-pr/ before deletion
  // so review agents can inspect what the PR changes without those files ever
  // being executed. Captured before the security delete so it reflects the
  // PR-authored version.
  rmSync(".kimi-pr", { recursive: true, force: true });
  for (const p of SENSITIVE_PATHS) {
    if (existsSync(p)) {
      snapshotSensitivePath(p, `.kimi-pr/${p}`);
    }
  }
  if (existsSync(".kimi-pr")) {
    console.log(
      "Preserved PR's sensitive paths -> .kimi-pr/ for review agents (not executed)",
    );
    ensureKimiPrExcludedFromGit();
  }

  // Delete PR-controlled versions BEFORE fetching so the attacker-controlled
  // .gitmodules is absent during the network operation. If git reads .gitmodules
  // during fetch (fetch.recurseSubmodules=on-demand, the git default), it will
  // attempt to fetch submodule objects and block on credential prompts in CI —
  // causing an indefinite hang. Deleting first closes that window.
  //
  // If the restore below fails for a given path, that path stays deleted —
  // the safe fallback (no attacker-controlled config). A bare `git checkout`
  // alone wouldn't remove files the PR added, so nuke first.
  for (const p of SENSITIVE_PATHS) {
    rmSync(p, { recursive: true, force: true });
  }

  // --no-recurse-submodules: explicitly suppress submodule fetching regardless of
  // fetch.recurseSubmodules config. Defense-in-depth alongside the delete above.
  execFileSync(
    "git",
    ["fetch", "origin", baseBranch, "--depth=1", "--no-recurse-submodules"],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  for (const p of SENSITIVE_PATHS) {
    try {
      execFileSync("git", ["checkout", `origin/${baseBranch}`, "--", p], {
        stdio: "pipe",
      });
    } catch {
      // Path doesn't exist on base — it stays deleted.
    }
  }

  // `git checkout <ref> -- <path>` stages the restored files. Unstage so the
  // revert doesn't silently leak into commits the CLI makes later.
  try {
    execFileSync("git", ["reset", "--", ...SENSITIVE_PATHS], {
      stdio: "pipe",
    });
  } catch {
    // Nothing was staged, or paths don't exist on HEAD — either is fine.
  }
}
