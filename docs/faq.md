# Frequently Asked Questions (FAQ)

## Triggering and Permissions

### Why doesn't tagging @kimi from my automated workflow work?

Comments created by a bot are ignored by default. Add the bot to `allowed_bots` (e.g.
`allowed_bots: "my-automation[bot]"`, or `"*"` to allow all bots — see
[security.md](./security.md) before using `*` on a public repo).

### Why does the action say the actor doesn't have write permissions?

Tag mode requires the actor who triggered it to have write access to the repository. This check
cannot be bypassed — there is no `allowed_non_write_users` equivalent. For read-only actors,
design the workflow so a human with write access triggers the run (e.g. via a label or a comment).

### Why can't I assign @kimi to an issue?

Assigning only triggers the action when the assignee matches `assignee_trigger` and the
assignment is done by a user with write access. Set `assignee_trigger` to the account you assign
(e.g. your own login or a dedicated bot account).

### Why am I getting '403 Resource not accessible by integration' errors?

The `github.token` needs the right permissions in the workflow's `permissions:` block. The usual
set for full functionality:

```yaml
permissions:
  contents: write # push branches/commits
  pull-requests: write # comment on and update PRs
  issues: write # comment on and label issues
  actions: read # read CI status and job logs on PRs
```

If `actions: read` is missing, the `github_ci` MCP server is skipped with a warning and the agent
cannot see CI results.

## Structured output

### Does the action support `--json-schema` / structured outputs?

No — kimi has no structured-output mode, so `--json-schema` in `kimi_args` is rejected with an
error. The alternative is prompt-and-parse:

1. Tell the agent exactly what to output in the `prompt`, e.g.
   `End your final message with a JSON object on its own last line: {"verdict": "pass"|"fail", "summary": "..."}`
2. Parse it in a follow-up step, e.g. with `jq`:

```yaml
- uses: xuwenhao/kimi-code-action@v0
  id: analyze
  with:
    kimi_api_key: ${{ secrets.KIMI_API_KEY }}
    prompt: |
      Analyze the test failures in the latest CI run.
      End your final message with a JSON object on its own last line:
      {"verdict": "flaky"|"real", "summary": "<one sentence>"}

- name: Parse verdict
  run: |
    tail -n 20 "${{ steps.analyze.outputs.execution_file }}" \
      | grep -o '{"verdict".*}' | tail -1 | jq .
```

The `session_id` output can also be used to continue the same conversation with `kimi -r` in a
later step.

## Agent Capabilities

### Why won't the agent update workflow files when I ask it to?

Writes and edits under `.github/workflows/` are denied by built-in permission rules that ship
with every run and cannot be overridden. This is deliberate: an agent that can edit workflows can
escalate its own privileges. Make workflow changes yourself or in a dedicated, human-triggered PR.

### Why won't the agent rebase my branch?

Git operations are limited to add/commit/push via explicit tool rules. Rebase, merge, and
force-push are not permitted (`Bash(git push --force*)` and `Bash(git push*-f*)` are denied by
default rules).

### Why won't the agent create a pull request?

It can't call the GitHub API to create PRs, but when it makes commits on a branch it posts a
prefilled "Create a PR" link in its comment — one click and the PR form opens with title and body
filled in.

### Can the agent see my GitHub Actions CI results?

Yes, on PRs, when `actions: read` is granted in the workflow permissions — the `github_ci` MCP
server exposes workflow runs, job details, and downloadable job logs. Without that permission the
server is skipped with a warning.

### Why does the agent only update one comment instead of creating new ones?

That's by design: everything (progress, answers, review feedback) goes into a single tracking
comment so the conversation stays in one place. Enable `use_sticky_comment: true` to reuse the
same comment across runs.

## Branch and Commit Behavior

### Why did the agent create a new branch when commenting on a closed PR?

The original PR branch is no longer active once a PR is closed or merged, so the agent creates a
fresh branch from the base branch and posts a prefilled PR link.

### Why are my commits shallow/missing history?

The examples use `fetch-depth: 1` for speed. The agent only needs the working tree for most
tasks. If you need history (e.g. `git log` analysis), set `fetch-depth: 0`.

## Configuration and Tools

### How does automatic mode detection work?

1. `prompt` non-empty → **agent mode** (automation, no tracking comment)
2. No `prompt`, but trigger phrase / assignee / label present → **tag mode** (interactive,
   tracking comment)
3. Neither → the action exits quietly
4. `track_progress: true` → forces tag mode for PR/issue events

### Why doesn't the agent execute my bash commands?

kimi's headless mode allows Bash by default, but the action's permission rules may deny specific
commands, and `--allowedTools` allow rules are mostly relevant when combined with denies. Check
the execution file for `was denied by permission rule` messages, and add an allow rule via
`kimi_args: --allowedTools "Bash(your-command:*)"`.

### Can the agent work across multiple repositories?

No. It operates on the checked-out repository only. Cross-repo operations would need to be
scripted in separate workflow steps.

### Why aren't comments posted as a custom bot?

Comments are posted by whichever token the action uses — the default `github.token` authors as
`github-actions[bot]`. To use a different identity, supply a PAT or a GitHub App token via
`github_token`, and set `bot_id`/`bot_name` to match for git commits.

## MCP Servers

### What MCP servers are available by default?

- `github_comment` — update the tracking comment (tag mode)
- `github_file_ops` — commit/delete files via the API (`use_commit_signing: true`)
- `github_inline_comment` — inline PR review comments (PR contexts)
- `github_ci` — CI status, workflow runs, job logs (PRs with `actions: read`)
- `github` — the official GitHub MCP server (when `mcp__github__*` tools are allowed)

Add your own with `--mcp-config` in `kimi_args` (inline JSON or file path, repeatable).

## Troubleshooting

### How can I debug what the agent is doing?

- Read the execution file (`execution_file` output) — the full JSONL stream.
- Enable `display_report: true` for a rendered Step Summary.
- As a last resort, `show_full_output: true` prints the raw stream to the log. **Warning:** it can
  contain secrets and is publicly visible — debug only, in non-sensitive repos.

### How can I use custom executables in specialized environments?

- `path_to_kimi_executable: /path/to/kimi` — skips the npm install; the binary is verified with
  `--version` before the run.
- `path_to_bun_executable: /path/to/bun` — same for Bun (the action code itself runs on Bun).

### The action fails with "kimi execution failed with exit code 1"

The CLI exited non-zero. The stderr tail is printed to the workflow log — common causes are an
invalid/expired `KIMI_API_KEY`, an unreachable `kimi_base_url`, or a malformed `settings`
fragment (TOML syntax error).

### The log shows "provider.auth_error: 401 Invalid Authentication"

Your API key and `kimi_base_url` belong to different systems. Kimi Code (Console subscription)
and the Kimi Open Platform issue keys that are NOT interchangeable — see
[Model and endpoint selection](setup.md#model-and-endpoint-selection) for the correct pairings.

## Best Practices

- Keep `permissions:` minimal per workflow — triage jobs only need `issues: write`.
- Prefer `--disallowedTools` for guardrails and let auto permissions handle the rest.
- Pin `kimi_version` once a workflow is proven, upgrade deliberately.
- Treat all issue/PR text as untrusted input — it is, and the action's defenses assume it.

## Getting Help

Open an issue in the action's repository with the workflow file, the failing run's log, and the
execution file attached.
