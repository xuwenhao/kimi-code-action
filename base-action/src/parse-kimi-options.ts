import * as core from "@actions/core";
import { readFile } from "fs/promises";
import { parse as parseShellArgs } from "shell-quote";
import type { PermissionRule } from "./kimi-home";

/**
 * Options accepted by runKimi — the parse layer turns these into
 * kimi CLI argv, permission rules, MCP servers and loop control settings.
 */
export type KimiOptions = {
  kimiArgs?: string;
  model?: string;
  pathToKimiExecutable?: string;
  allowedTools?: string;
  disallowedTools?: string;
  maxTurns?: string;
  mcpConfig?: string;
  appendSystemPrompt?: string;
  settingsFragment?: string;
  showFullOutput?: string;
};

/**
 * Result of parsing KimiOptions for the kimi CLI.
 */
export type ParsedKimiOptions = {
  /** Extra argv entries appended to the kimi invocation */
  extraArgs: string[];
  /** Permission rules for config.toml, deny rules first */
  permissionRules: PermissionRule[];
  /** Merged MCP servers for mcp.json */
  mcpServers: Record<string, unknown>;
  /** [loop_control] max_steps_per_turn */
  maxSteps?: number;
  /** Text prepended to the prompt (kimi has no system-prompt flag) */
  appendSystemPrompt?: string;
  showFullOutput: boolean;
};

// Flags that should accumulate multiple values instead of overwriting
// Include both camelCase and hyphenated variants for CLI compatibility
const ACCUMULATING_FLAGS = new Set([
  "allowedTools",
  "allowed-tools",
  "disallowedTools",
  "disallowed-tools",
  "mcp-config",
  "add-dir",
]);

// Delimiter used to join accumulated flag values
const ACCUMULATE_DELIMITER = "\x00";

// shell-quote treats ()|&;<> as control operators and splits adjacent text
// around them into separate tokens (returned as `{op}` objects, which we then
// dropped). For CLI args these must be literal characters — e.g. unquoted
// `--allowedTools Bash(gh:*)` was being mangled into bare `Bash`, silently
// widening a scoped permission rule to Bash(*). We escape each metachar to a
// Unicode private-use codepoint before parsing and restore it afterward,
// keeping shell-quote's quote/whitespace handling intact.
// (Written as \u escapes rather than literal private-use codepoints
// so the mapping stays visible and diff-friendly.)
const SHELL_META_PAIRS: [string, string][] = [
  ["(", "\uE000"],
  [")", "\uE001"],
  ["|", "\uE002"],
  ["&", "\uE003"],
  [";", "\uE004"],
  ["<", "\uE005"],
  [">", "\uE006"],
];
const SHELL_META_ESCAPE = new Map(SHELL_META_PAIRS);
const SHELL_META_UNESCAPE = new Map(SHELL_META_PAIRS.map(([k, v]) => [v, k]));
const SHELL_META_ESCAPE_RE = /[()|&;<>]/g;
const SHELL_META_UNESCAPE_RE = /[\uE000-\uE006]/g;

function escapeShellMeta(s: string): string {
  return s.replace(SHELL_META_ESCAPE_RE, (c) => SHELL_META_ESCAPE.get(c)!);
}

function unescapeShellMeta(s: string): string {
  return s.replace(SHELL_META_UNESCAPE_RE, (c) => SHELL_META_UNESCAPE.get(c)!);
}

type McpConfig = {
  mcpServers?: Record<string, unknown>;
};

/**
 * Merge multiple MCP config values into a single mcpServers record.
 * Each value is either an inline JSON string or a path to a JSON file
 * (kimi only reads $KIMI_CODE_HOME/mcp.json, so files must be read and
 * merged here instead of being passed through to the CLI).
 * Later values win on server-name conflicts.
 */
async function mergeMcpServerConfigs(
  configValues: string[],
): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = {};

  for (const config of configValues) {
    const trimmed = config.trim();
    if (!trimmed) continue;

    let parsed: McpConfig;
    if (trimmed.startsWith("{")) {
      try {
        parsed = JSON.parse(trimmed) as McpConfig;
      } catch {
        throw new Error(
          `Failed to parse --mcp-config value as JSON: ${trimmed.slice(0, 120)}`,
        );
      }
    } else {
      let fileContent: string;
      try {
        fileContent = await readFile(trimmed, "utf-8");
      } catch (error) {
        throw new Error(
          `Failed to read --mcp-config file '${trimmed}': ${error}`,
        );
      }
      try {
        parsed = JSON.parse(fileContent) as McpConfig;
      } catch {
        throw new Error(
          `Failed to parse --mcp-config file '${trimmed}' as JSON`,
        );
      }
    }

    if (parsed.mcpServers) {
      Object.assign(merged, parsed.mcpServers);
    }
  }

  return merged;
}

/**
 * Strip comment lines from a shell argument string.
 * Lines whose first non-whitespace character is `#` are removed entirely.
 * Inline `#` within a line (e.g. inside a quoted value) is left untouched
 * because shell-quote handles quoting — we only need to remove full comment lines
 * before shell-quote sees them.
 */
function stripShellComments(input: string): string {
  return input
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

/**
 * Parse a kimiArgs string into a flag record.
 * Accumulating flags consume all consecutive non-flag values
 * (e.g., --allowed-tools "Tool1" "Tool2" "Tool3" captures all three)
 * and repeat occurrences are joined with ACCUMULATE_DELIMITER.
 */
function parseKimiArgsToFlagRecord(
  kimiArgs?: string,
): Record<string, string | null> {
  if (!kimiArgs?.trim()) return {};

  const result: Record<string, string | null> = {};
  const args = parseShellArgs(escapeShellMeta(stripShellComments(kimiArgs)))
    .map((arg) => {
      if (typeof arg === "string") return unescapeShellMeta(arg);
      // With control metachars escaped above, the only non-string shell-quote
      // can still emit is a glob op (bareword containing *, ?, or [). Its
      // `pattern` field is the verbatim token text — use it as-is so values
      // like `Bash(cmd:*)` and `Read(path/**)` round-trip intact.
      if (typeof arg === "object" && arg !== null && "pattern" in arg) {
        return unescapeShellMeta((arg as { pattern: string }).pattern);
      }
      return undefined;
    })
    .filter((arg): arg is string => typeof arg === "string");

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    // "-m" is the short form of --model; treat it as flag "m"
    const flag = arg?.startsWith("--")
      ? arg.slice(2)
      : arg === "-m"
        ? "m"
        : null;
    if (flag !== null) {
      const nextArg = args[i + 1];

      // Check if next arg is a value (not another flag)
      if (nextArg && !nextArg.startsWith("--")) {
        // For accumulating flags, consume all consecutive non-flag values
        // This handles: --allowed-tools "Tool1" "Tool2" "Tool3"
        if (ACCUMULATING_FLAGS.has(flag)) {
          const values: string[] = [];
          while (i + 1 < args.length && !args[i + 1]?.startsWith("--")) {
            i++;
            values.push(args[i]!);
          }
          const joinedValues = values.join(ACCUMULATE_DELIMITER);
          if (result[flag]) {
            result[flag] =
              `${result[flag]}${ACCUMULATE_DELIMITER}${joinedValues}`;
          } else {
            result[flag] = joinedValues;
          }
        } else {
          result[flag] = nextArg;
          i++; // Skip the value
        }
      } else {
        result[flag] = null; // Boolean flag
      }
    }
  }

  return result;
}

/**
 * Tool name translation from Claude Code names to kimi CLI names.
 * A null value means the tool has no kimi equivalent and is dropped.
 */
const TOOL_NAME_MAP: Record<string, string | null> = {
  WebFetch: "FetchURL",
  TodoWrite: "TodoList",
  LS: "Glob",
  NotebookEdit: null,
};

// Tool names that are valid as-is for kimi (no translation needed)
const PASSTHROUGH_TOOLS = new Set([
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebSearch",
  "FetchURL",
  "TodoList",
]);

/**
 * Translate one allowedTools/disallowedTools entry into a kimi permission
 * pattern. Returns undefined when the entry should be dropped.
 *
 * Scoped Claude patterns use a colon before the glob (e.g. `Bash(git add:*)`),
 * while kimi permission patterns are plain prefix matches (`Bash(git add*)`).
 * The colon form is normalized here so deny rules actually take effect —
 * passing `:*` through verbatim would silently never match.
 */
function translateToolPattern(tool: string): string | undefined {
  // MCP tool patterns pass through unchanged
  if (tool.startsWith("mcp__")) return tool;

  const parenIndex = tool.indexOf("(");
  const name = parenIndex === -1 ? tool : tool.slice(0, parenIndex);
  const scope = parenIndex === -1 ? "" : tool.slice(parenIndex);

  if (name in TOOL_NAME_MAP) {
    const mapped = TOOL_NAME_MAP[name];
    if (mapped === null) {
      core.warning(
        `Tool '${name}' has no kimi equivalent and will be dropped from permission rules`,
      );
      return undefined;
    }
    return mapped + scope;
  }

  if (name === "Bash" && scope) {
    return name + scope.replace(/:\*/g, "*");
  }

  if (PASSTHROUGH_TOOLS.has(name)) {
    return tool;
  }

  core.warning(
    `Unknown tool '${tool}' passed through to permission rules unchanged — verify it matches a kimi tool name`,
  );
  return tool;
}

/**
 * Merge allowed/disallowed tool entries from kimiArgs flags and the direct
 * option, translate them to kimi permission patterns, and dedupe.
 */
function collectToolPatterns(
  flagValues: (string | null | undefined)[],
  directOption: string | undefined,
  translate: (tool: string) => string | undefined,
): string[] {
  const fromFlags = flagValues
    .filter(Boolean)
    .join(ACCUMULATE_DELIMITER)
    .split(ACCUMULATE_DELIMITER)
    .flatMap((v) => v.split(","))
    .map((t) => t.trim())
    .filter(Boolean);

  const fromDirect = directOption
    ? directOption
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const translated = [...fromFlags, ...fromDirect]
    .map(translate)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  return [...new Set(translated)];
}

/**
 * Parse KimiOptions into CLI argv, permission rules, MCP servers and
 * loop-control settings for the kimi CLI.
 */
export async function parseKimiOptions(
  options: KimiOptions,
): Promise<ParsedKimiOptions> {
  // Determine output verbosity
  const isDebugMode = process.env.ACTIONS_STEP_DEBUG === "true";
  const showFullOutput = options.showFullOutput === "true" || isDebugMode;

  const flagRecord = parseKimiArgsToFlagRecord(options.kimiArgs);

  // Flags with no kimi equivalent fail fast instead of being silently ignored
  if ("json-schema" in flagRecord) {
    throw new Error(
      "--json-schema is not supported: kimi has no structured output mode. Parse the final assistant message in a downstream step instead.",
    );
  }
  if ("system-prompt" in flagRecord) {
    throw new Error(
      "--system-prompt is not supported: kimi has no system-prompt presets. Put the instructions directly in the prompt, or use --append-system-prompt to prepend them.",
    );
  }

  // --permission-mode: kimi -p always runs with auto permissions, so the
  // only Claude mode we can approximate is acceptEdits. Everything else
  // would change the security posture and is rejected.
  const permissionMode = flagRecord["permission-mode"];
  delete flagRecord["permission-mode"];
  if (permissionMode != null) {
    if (permissionMode === "acceptEdits") {
      core.warning(
        "--permission-mode acceptEdits is ignored: kimi -p always runs with auto permissions (deny rules still apply).",
      );
    } else {
      throw new Error(
        `--permission-mode ${permissionMode} is not supported: kimi -p always runs with auto permissions. Use allowed/disallowed tool rules to restrict behavior.`,
      );
    }
  }

  // Model: direct option wins over --model/-m in kimiArgs
  const modelFromArgs = flagRecord["model"] ?? flagRecord["m"] ?? undefined;
  delete flagRecord["model"];
  delete flagRecord["m"];
  const model = options.model || modelFromArgs;

  // allowed/disallowed tools → permission rules (deny first)
  const allowPatterns = collectToolPatterns(
    [flagRecord["allowedTools"], flagRecord["allowed-tools"]],
    options.allowedTools,
    translateToolPattern,
  );
  delete flagRecord["allowedTools"];
  delete flagRecord["allowed-tools"];

  const denyPatterns = collectToolPatterns(
    [flagRecord["disallowedTools"], flagRecord["disallowed-tools"]],
    options.disallowedTools,
    translateToolPattern,
  );
  delete flagRecord["disallowedTools"];
  delete flagRecord["disallowed-tools"];

  const permissionRules: PermissionRule[] = [
    ...denyPatterns.map((pattern) => ({ decision: "deny" as const, pattern })),
    ...allowPatterns.map((pattern) => ({
      decision: "allow" as const,
      pattern,
    })),
  ];

  // --mcp-config values (repeatable) merge into one mcpServers record.
  // The direct mcpConfig option is applied first so kimiArgs (which carries
  // the action's own GitHub MCP servers) wins on conflicts.
  const mcpConfigValues = [
    ...(options.mcpConfig ? [options.mcpConfig] : []),
    ...(flagRecord["mcp-config"]
      ? flagRecord["mcp-config"].split(ACCUMULATE_DELIMITER)
      : []),
  ];
  delete flagRecord["mcp-config"];
  const mcpServers = await mergeMcpServerConfigs(mcpConfigValues);

  // --max-turns → [loop_control] max_steps_per_turn; direct option wins
  const maxTurnsFromArgs = flagRecord["max-turns"];
  delete flagRecord["max-turns"];
  const maxTurns = options.maxTurns || maxTurnsFromArgs || undefined;
  const maxSteps = maxTurns ? parseInt(maxTurns, 10) : undefined;
  if (maxSteps !== undefined && (Number.isNaN(maxSteps) || maxSteps <= 0)) {
    throw new Error(
      `--max-turns must be a positive integer, got '${maxTurns}'`,
    );
  }

  // --append-system-prompt → prepended to the prompt; direct option wins
  const appendSystemPrompt =
    options.appendSystemPrompt ||
    flagRecord["append-system-prompt"] ||
    undefined;
  delete flagRecord["append-system-prompt"];

  // Remaining flags pass through to the kimi CLI as-is
  const extraArgs: string[] = [];
  for (const [flag, value] of Object.entries(flagRecord)) {
    if (value === null) {
      extraArgs.push(`--${flag}`);
    } else {
      // Accumulated values become repeated flag entries
      for (const part of value.split(ACCUMULATE_DELIMITER)) {
        extraArgs.push(`--${flag}`, part);
      }
    }
  }
  if (model) {
    extraArgs.push("--model", model);
  }

  return {
    extraArgs,
    permissionRules,
    mcpServers,
    maxSteps,
    appendSystemPrompt,
    showFullOutput,
  };
}
