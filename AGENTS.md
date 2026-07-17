# AGENTS.md

Development guide for this repository (kimi-code-action). Keep it current when you change
commands, layout, or conventions.

## Commands

```bash
bun install             # Install dependencies
bun test                # Run tests (unit tests only; no e2e in this repo)
bun run typecheck       # TypeScript type checking (tsc --noEmit)
bun run format          # Format with prettier
bun run format:check    # Check formatting (CI enforces this)
```

All three checks (`bun test`, `bun run typecheck`, `bun run format:check`) must pass before
committing.

## What This Is

A GitHub Action that lets the kimi-code CLI respond to `@kimi` mentions on issues/PRs (tag mode)
or run tasks via the `prompt` input (agent mode). Mode is auto-detected: non-empty `prompt` →
agent mode; trigger phrase/assignee/label event → tag mode. See `src/modes/detector.ts`.

Derived from `anthropics/claude-code-action` (see NOTICE); the GitHub-side scaffolding is
inherited, the agent runtime is kimi (`kimi -p --output-format stream-json`).

## How It Runs

Single entrypoint: `src/entrypoints/run.ts` orchestrates everything — prepare (auth, permissions,
trigger check, branch/comment creation), install the kimi-code CLI (npm, or
`path_to_kimi_executable`), execute via `base-action/` functions (imported directly, not
subprocess), then cleanup (update tracking comment, write step summary). SSH signing cleanup and
buffered inline-comment posting are separate `always()` steps in `action.yml`.

`base-action/` is the internal runner layer (also has a standalone `action.yml`). It reads config
from `INPUT_`-prefixed env vars (set by the root `action.yml`), not from action inputs directly.

Key runner pieces:

- `base-action/src/run-kimi.ts` — spawns the CLI, parses the JSONL stream, writes the execution
  file, extracts `session_id`
- `base-action/src/parse-kimi-options.ts` — `kimi_args` parsing; maps flags to permission
  rules / MCP config / loop control (tool-name translation table lives here)
- `base-action/src/kimi-home.ts` — generates the isolated `KIMI_CODE_HOME` (config.toml with
  built-in deny rules first, mcp.json)
- `base-action/src/setup-kimi-settings.ts` — the `settings` input → TOML fragment

## Key Concepts

**Auth priority**: `github_token` input (user-provided) > `github.token` (default workflow
token). Token setup lives in `src/github/token.ts`. `kimi_api_key` is for the model API only
(becomes `KIMI_API_KEY`/`KIMI_MODEL_API_KEY`); it never touches GitHub.

**Mode lifecycle**: `detectMode()` picks "tag" or "agent". Tag mode calls `prepareTagMode()`
(`src/modes/tag/`), agent mode calls `prepareAgentMode()` (`src/modes/agent/`); both assemble
MCP config and `kimi_args`.

**Prompt construction**: tag mode fetches GitHub data (`src/github/data/fetcher.ts`), formats it
(`src/github/data/formatter.ts`), and writes the prompt via `createPrompt()`. Only the trigger
comment is framed as instructions — everything else is context (the prompt-injection defense
line). Keep that hierarchy intact when editing `src/create-prompt/index.ts`.

**Security mechanisms that must keep working**: write-permission check (no bypass), TOCTOU
comment filtering (only pre-trigger comments), output sanitizer, `restoreConfigFromBase`
(restores `.kimi-code/`, `AGENTS.md`, `.mcp.json`, `.gitmodules`, `.ripgreprc`, `.husky` from
the PR base branch), built-in deny rules (`.github/workflows/**` writes, force push), OIDC env
scrub for the agent subprocess.

## Things That Will Bite You

- **Strict TypeScript**: `noUnusedLocals` and `noUnusedParameters` are enabled. Typecheck fails
  on unused variables.
- **Discriminated unions for GitHub context**: call `isEntityContext(context)` before accessing
  entity-specific fields.
- **`action.yml` outputs reference step IDs**: outputs like `execution_file`, `branch_name`,
  `github_token` reference `steps.run.outputs.*`. Rename the step ID → update outputs too.
- **Execution file is JSONL**, one stream-json message per line (assistant/tool/meta). The step
  summary renderer is `src/entrypoints/format-turns.ts` — keep it in sync with the schema in
  `docs/kimi-headless-notes.md`.
- **Tool rules are first-match-wins**: built-in denies are written before user rules in
  `kimi-home.ts`; do not reorder.
- **Testing**: the tests here are unit tests (bun test). e2e workflows live in
  `.github/workflows/test-*.yml`, gated behind the `E2E_ENABLED` repo variable.

## Code Conventions

- Runtime is Bun, not Node. Use `bun test`, not jest.
- `moduleResolution: "bundler"` — imports don't need `.js` extensions.
- GitHub API calls should use retry logic (`src/utils/retry.ts`).
- MCP servers are plain stdio TypeScript servers under `src/mcp/`, spawned by the CLI from the
  generated `mcp.json`.
- Commit messages follow conventional commits (`feat:`, `fix:`, `chore:`, …).
