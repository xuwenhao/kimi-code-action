import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export type PermissionRule = {
  decision: "allow" | "deny";
  pattern: string;
  reason?: string;
};

export type KimiHomeConfig = {
  /** User/extra rules, expected deny-first; written after the default denies */
  permissionRules: PermissionRule[];
  mcpServers: Record<string, unknown>;
  maxSteps?: number;
  /** Raw TOML appended verbatim to config.toml (the `settings` input) */
  settingsFragment?: string;
};

/**
 * Deny rules every run gets, regardless of user configuration.
 * Permission rules are first-match-wins, so these come first in config.toml
 * and cannot be overridden by user allow rules.
 * Path patterns need globstar (`**`) — a single `*` does not cross `/`.
 */
export const DEFAULT_DENY_RULES: PermissionRule[] = [
  {
    decision: "deny",
    pattern: "Write(.github/workflows/**)",
    reason: "Modifying .github/workflows is not allowed",
  },
  {
    decision: "deny",
    pattern: "Edit(.github/workflows/**)",
    reason: "Modifying .github/workflows is not allowed",
  },
  {
    decision: "deny",
    pattern: "Bash(git push --force*)",
    reason: "Force-pushing is not allowed",
  },
  {
    decision: "deny",
    pattern: "Bash(git push*-f*)",
    reason: "Force-pushing is not allowed",
  },
];

/**
 * JSON string escaping is valid TOML basic-string escaping for the
 * characters that can appear in our patterns and reasons.
 */
function tomlBasicString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Generate an isolated KIMI_CODE_HOME for one run: config.toml (permission
 * rules + loop control + settings fragment) and, when MCP servers are
 * configured, mcp.json. Returns the home directory path.
 */
export async function writeKimiHome(config: KimiHomeConfig): Promise<string> {
  const baseDir = process.env.RUNNER_TEMP || tmpdir();
  const homeDir = await mkdtemp(join(baseDir, "kimi-home-"));

  let configToml = "";
  for (const rule of [...DEFAULT_DENY_RULES, ...config.permissionRules]) {
    configToml += "[[permission.rules]]\n";
    configToml += `decision = "${rule.decision}"\n`;
    configToml += `pattern = ${tomlBasicString(rule.pattern)}\n`;
    if (rule.reason) {
      configToml += `reason = ${tomlBasicString(rule.reason)}\n`;
    }
    configToml += "\n";
  }

  if (config.maxSteps !== undefined) {
    configToml += "[loop_control]\n";
    configToml += `max_steps_per_turn = ${config.maxSteps}\n\n`;
  }

  if (config.settingsFragment?.trim()) {
    configToml += `${config.settingsFragment.trimEnd()}\n`;
  }

  await writeFile(join(homeDir, "config.toml"), configToml);

  if (Object.keys(config.mcpServers).length > 0) {
    await writeFile(
      join(homeDir, "mcp.json"),
      JSON.stringify({ mcpServers: config.mcpServers }, null, 2),
    );
  }

  return homeDir;
}
