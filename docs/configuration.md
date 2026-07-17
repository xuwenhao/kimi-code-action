# Configuration

This action runs the [kimi-code CLI](https://github.com/MoonshotAI/kimi-code) headless
(`kimi -p --output-format stream-json`) inside an isolated `KIMI_CODE_HOME` it generates per run.
Everything about tool permissions, MCP servers, and loop limits flows through that generated
configuration — this document is the reference for it.

## How a run is wired

For every execution the action:

1. Generates a fresh `KIMI_CODE_HOME` under `$RUNNER_TEMP` containing:
   - `config.toml` — permission rules (`[[permission.rules]]`), optional `[loop_control]`,
     and your `settings` fragment appended verbatim.
   - `mcp.json` — merged MCP server definitions (only when at least one server is configured).
2. Assembles the prompt (your `prompt`, or the generated tag-mode prompt; `--append-system-prompt`
   text is prepended; the triggering comment is appended verbatim).
3. Spawns `kimi -p <prompt> --output-format stream-json` with:
   - `KIMI_CODE_HOME` pointing at the generated directory
   - `KIMI_MODEL_NAME` / `KIMI_MODEL_API_KEY` / `KIMI_MODEL_BASE_URL` from `kimi_model` /
     `kimi_api_key` / `kimi_base_url`
   - `KIMI_DISABLE_TELEMETRY=1`
   - `ACTIONS_ID_TOKEN_REQUEST_URL` / `ACTIONS_ID_TOKEN_REQUEST_TOKEN` **removed**, so the agent
     cannot mint new GitHub OIDC tokens
4. Parses the JSONL stream, writes it to the execution file, and sets `session_id` /
   `execution_file` / `branch_name` outputs.

## Permission rules

kimi's headless mode runs with `auto` permissions: ordinary tools (Read/Write/Edit/Bash/Glob/...)
are allowed by default, and `[[permission.rules]]` in `config.toml` refine that — first match wins.

Rule order in the generated `config.toml`:

1. **Built-in deny rules** (always present, cannot be overridden by later rules):

   ```toml
   [[permission.rules]] # Write(.github/workflows/**) — deny
   [[permission.rules]] # Edit(.github/workflows/**)  — deny
   [[permission.rules]] # Bash(git push --force*)     — deny
   [[permission.rules]] # Bash(git push*-f*)          — deny
   ```

   These keep the agent from modifying workflow files (the classic self-escalation path) and
   from force-pushing. Path patterns need globstar (`**`); a single `*` does not cross `/`.

2. **Your deny rules** (from `--disallowedTools`)
3. **Your allow rules** (from `--allowedTools`)

Because allow rules come last, you can carve exceptions back out of your own denies, but never
out of the four built-in denies.

## `kimi_args` flag mapping

`kimi_args` is parsed with shell-quote semantics (quotes, comments with `#`, and multi-line values
all work) and mapped as follows:

| Flag                                       | Mapping                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--allowedTools` / `--allowed-tools`       | Comma-separated tool patterns → `allow` permission rules (translated, see below). Repeatable; multiple values accumulate.             |
| `--disallowedTools` / `--disallowed-tools` | Same, but → `deny` rules (placed before allow rules).                                                                                 |
| `--max-turns N`                            | `[loop_control] max_steps_per_turn = N` in config.toml.                                                                               |
| `--mcp-config <value>`                     | Inline JSON or a path to a JSON file. Repeatable; all values merge into `mcp.json` (`mcpServers` objects combined, later values win). |
| `--append-system-prompt <text>`            | Prepended to the prompt text (kimi has no system-prompt flag).                                                                        |
| `--model <alias>` / `-m <alias>`           | Passed through to the CLI as `--model`. The `kimi_model` input / `KIMI_MODEL_NAME` is usually the better way.                         |
| `--permission-mode acceptEdits`            | Ignored with a warning — `kimi -p` always runs with auto permissions.                                                                 |
| any other flag                             | Passed through to the kimi CLI unchanged.                                                                                             |

**Rejected with an error** (no kimi equivalent):

- `--json-schema` — no structured output mode; see the [FAQ](./faq.md) for the prompt-and-parse alternative
- `--system-prompt` — no system-prompt presets; put instructions in `prompt` or use `--append-system-prompt`
- `--permission-mode plan|bypassPermissions|default` — would change the security posture

### Tool name translation

`--allowedTools` / `--disallowedTools` accept Claude-style tool names for familiarity; they are
translated to kimi names:

| You write                                                                   | kimi gets                                                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `WebFetch`                                                                  | `FetchURL`                                                                                                              |
| `TodoWrite`                                                                 | `TodoList`                                                                                                              |
| `LS`                                                                        | `Glob`                                                                                                                  |
| `NotebookEdit`                                                              | dropped (warning)                                                                                                       |
| `Bash(git add:*)`                                                           | `Bash(git add*)` — the Claude `:*` suffix is normalized to kimi's plain prefix match so deny rules actually take effect |
| `Bash(...)`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch`, `mcp__*` | unchanged                                                                                                               |
| anything else                                                               | passed through unchanged, with a warning to verify the kimi tool name                                                   |

## MCP servers

kimi has no `--mcp-config` flag — it reads `$KIMI_CODE_HOME/mcp.json`. The action merges, in order:

1. Its own GitHub servers (passed in by the mode preparation):
   - `github_comment` — `update_kimi_comment` tool for the tracking comment (tag mode always;
     agent mode when `mcp__github_comment__*` tools are allowed)
   - `github_file_ops` — commit/delete files via the GitHub API (when `use_commit_signing: true`)
   - `github_inline_comment` — inline PR review comments (PR contexts, when allowed)
   - `github_ci` — workflow runs, job logs, CI status (PR contexts with a workflow token;
     requires `actions: read` — auto-detected, skipped with a warning otherwise)
   - `github` — the official GitHub MCP server via Docker (when `mcp__github__*` tools are allowed)
2. Your `--mcp-config` values (inline JSON or file paths, repeatable).

Server entries use the standard stdio shape: `{ "mcpServers": { "name": { "command": "...",
"args": [...], "env": {...} } } }`. Name collisions are resolved last-write-wins.

MCP-related environment variables pass through when set at the job level: `MCP_TIMEOUT`,
`MCP_TOOL_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS`.

## `settings` input

The `settings` input is a kimi `config.toml` fragment — either inline TOML text or a path to a
`.toml` file. It is appended verbatim to the generated `config.toml` (after permission rules and
loop control), so anything kimi understands in `config.toml` can go here:

```yaml
settings: |
  [loop_control]
  max_steps_per_turn = 30
```

It is **not** parsed or validated by the action — a TOML error will fail the CLI, so keep
fragments small and test them locally.

## Commit signing

Two ways to get verified commits, `ssh_signing_key` taking precedence:

- `use_commit_signing: true` — commits are made through the GitHub API (`github_file_ops` MCP
  server) and show as verified.
- `ssh_signing_key: ${{ secrets.KIMI_SSH_SIGNING_KEY }}` — git is configured for SSH signing with
  the given private key; the key file is deleted in a post step either way.

With neither, the agent commits with plain `git` as `bot_name`/`bot_id`
(defaults: `github-actions[bot]` / `41898282`) and pushes through the bundled `git-push.sh`
wrapper, which blocks force pushes and pushes to the default branch.

## Environment variables the action sets for the CLI

| Variable                 | Source                                                 |
| ------------------------ | ------------------------------------------------------ |
| `KIMI_CODE_HOME`         | Generated per run under `$RUNNER_TEMP`                 |
| `KIMI_API_KEY`           | `kimi_api_key` input                                   |
| `KIMI_MODEL_NAME`        | `kimi_model` input                                     |
| `KIMI_MODEL_API_KEY`     | `kimi_api_key` input                                   |
| `KIMI_PLATFORM`          | `kimi_platform` input (used by the startup validation) |
| `KIMI_MODEL_BASE_URL`    | `kimi_base_url` input, else the `kimi_platform` preset |
| `KIMI_DISABLE_TELEMETRY` | always `1`                                             |
| `KIMI_VERSION`           | `kimi_version` input (install-time only)               |

## Verifying a run

- The execution file (JSONL stream) is the source of truth — download it via the `execution_file`
  output.
- `display_report: true` writes a rendered report to the GitHub Step Summary.
- `show_full_output: true` (or Actions step debug) prints the raw stream, including tool inputs
  and outputs — **may contain secrets**; use only for debugging in non-sensitive repositories.
