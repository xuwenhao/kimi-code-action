# Security

## Access control

Tag mode verifies that the triggering actor has **write access** to the repository before doing
any work. The check cannot be disabled or bypassed — there is no `allowed_non_write_users`
equivalent. Bot actors are rejected unless explicitly listed in `allowed_bots`; a bot account
resolving to a regular user account still goes through the write-permission check.

> **`allowed_bots: "*"` on public repos:** any external GitHub App can then trigger the action
> with prompts it controls. Prefer explicit bot logins.

The GitHub token only ever sees two uses: GitHub API calls and git pushes. It is passed to MCP
servers via their `env` and to git via the remote URL; it is never sent to the model provider.

## Using this action with `pull_request_target` or `workflow_run`

These triggers run with elevated permissions on untrusted PR code. The action itself is built
for that (see the defenses below), but the workflow around it matters just as much:

- Prefer checking out the **base ref** (the default for `pull_request_target`) unless the agent
  needs the PR's files.
- Keep the job's `permissions:` minimal.
- Remember that build/test commands the agent runs (`npm install`, test suites) execute
  PR-controlled code — see the warning in
  [`examples/ci-failure-auto-fix.yml`](../examples/ci-failure-auto-fix.yml).

## Prompt injection defenses

Issue and PR text is untrusted input. The action assumes it is hostile and defends in layers:

- **Instruction hierarchy in the prompt**: only the trigger comment is presented as instructions;
  other comments, the issue/PR body, and repository files are explicitly marked as context.
- **TOCTOU comment filtering**: when fetching discussion data, only comments created _before_ the
  trigger timestamp are included, so an attacker cannot pile instructions in after triggering.
- **Output sanitization**: content fetched from GitHub is sanitized before reaching the model and
  again before being posted back.
- **Config restore from the base branch**: on PRs, `.kimi-code/`, `AGENTS.md`, `.mcp.json`,
  `.gitmodules`, `.ripgreprc`, and `.husky` are restored from the PR's base branch before the CLI
  starts, because the PR head could otherwise plant MCP server definitions, tampered permission
  rules, or injected instructions. PR-authored versions are snapshotted to `.kimi-pr/` (never
  executed) for review.
- **OIDC scrub**: `ACTIONS_ID_TOKEN_REQUEST_URL` / `ACTIONS_ID_TOKEN_REQUEST_TOKEN` are removed
  from the agent's environment so it cannot mint GitHub OIDC tokens.

## Permission rules

Every run generates a `config.toml` whose `[[permission.rules]]` start with four built-in denies
(first match wins — user rules cannot override them):

- `Write(.github/workflows/**)` and `Edit(.github/workflows/**)` — no workflow edits, closing
  the self-escalation path
- `Bash(git push --force*)` and `Bash(git push*-f*)` — no force pushes

Your `--allowedTools` / `--disallowedTools` in `kimi_args` become additional rules (deny first).
kimi's `auto` mode allows ordinary tools by default, so prefer denies for guardrails. Pushes also
go through the bundled `git-push.sh` wrapper, which refuses force pushes and pushes to the
repository's default branch.

## Pull request creation

The agent never opens PRs by itself — it pushes commits to a branch and posts a prefilled
"Create a PR" link in its comment. A human clicks through and reviews the diff before the PR
exists.

## Permissions used by the action

| Permission             | Used for                                                                    |
| ---------------------- | --------------------------------------------------------------------------- |
| `contents: write`      | pushing branches/commits, restoring config from the base branch             |
| `pull-requests: write` | tracking comments, PR metadata                                              |
| `issues: write`        | issue comments, labels                                                      |
| `actions: read`        | CI status and job logs on PRs (optional; `github_ci` is skipped without it) |
| `id-token: write`      | **not required** — there is no OIDC exchange                                |

## Commit signing

Both options produce commits GitHub marks as verified; `ssh_signing_key` takes precedence:

- **`use_commit_signing: true`** — commits are created through the GitHub API (the
  `github_file_ops` MCP server), so they are signed by GitHub.
- **`ssh_signing_key: ${{ secrets.KIMI_SSH_SIGNING_KEY }}`** — the private key is written to
  `~/.ssh/kimi_signing_key` with mode 600, git is configured for SSH signing, and the key file is
  deleted in a post step even if the run fails. Never echo the key; store it as a secret.

## Authentication protection

Always reference secrets — never inline them:

```yaml
# CORRECT ✅
kimi_api_key: ${{ secrets.KIMI_API_KEY }}

# NEVER DO THIS ❌
kimi_api_key: sk-...
```

The API key is masked in logs via the secrets mechanism, is only sent to the configured
`kimi_base_url` (default: Moonshot), and the agent subprocess gets the same value through
`KIMI_MODEL_API_KEY`.

## ⚠️ Full output security warning

`show_full_output: true` (and Actions step debug mode) print the entire stream-json log —
assistant messages, tool inputs, and tool outputs. Tool results may contain file contents,
secrets, or tokens, and workflow logs are visible to anyone with read access to the repo
(publicly, on public repos).

**Recommended practice:** debug with the execution file and `display_report: true` first; enable
`show_full_output` only in private, non-sensitive repositories.
