> **Fork notice**: this repo is `kimi-code-action`, derived from
> [claude-code-action](https://github.com/anthropics/claude-code-action) at upstream commit
> `3e807ec379b815f9623b7ceca6c7f1f8585e9ead` (see [NOTICE](./NOTICE)). The GitHub-side
> scaffolding (modes, tracking comments, inline comments, security hardening) is inherited;
> the agent runtime is the [kimi-code CLI](https://github.com/MoonshotAI/kimi-code) instead of
> Claude Code. See [Differences from upstream](#differences-from-upstream) for what was dropped.

# Kimi Code Action

A general-purpose GitHub Action for PRs and issues, driven by the kimi-code CLI. Mention `@kimi`
in a comment and the agent answers questions, reviews code, or implements changes in a single
tracking comment; or give it a `prompt` and it runs as hands-off automation. The action
auto-detects which mode to run based on the event — no mode configuration needed.

## Features

- 🎯 **Automatic mode detection**: `prompt` present → automation mode; `@kimi` mention → interactive tag mode with a tracking comment
- 🤖 **Interactive code assistant**: answers questions about code, architecture, and programming
- 🔍 **Code review**: analyzes PR changes and posts review feedback, including inline comments on specific lines
- ✨ **Code implementation**: implements simple fixes, refactors, and new features, then pushes to a branch
- 📋 **Progress tracking**: checklist-style tracking comment updated as the agent works (`use_sticky_comment` to keep just one)
- 🔏 **Commit signing**: GitHub API-based signing (`use_commit_signing`) or your own SSH key (`ssh_signing_key`)
- 🔁 **Session resume**: every run outputs a `session_id` you can continue with `kimi -r`
- 🛡️ **Security hardening**: write-permission checks, prompt-injection defenses, config restore from the base branch, and default deny rules for `.github/workflows` and force-pushes
- 🏃 **Runs on your infrastructure**: the agent executes entirely on your GitHub runner; the only external call is the model API

## Quickstart

1. Get an API key from the Moonshot open platform ([platform.moonshot.ai](https://platform.moonshot.ai)
   or [platform.kimi.com](https://platform.kimi.com)) and add it to your repository secrets as `KIMI_API_KEY`.
2. Add `.github/workflows/kimi.yml` to your repo:

```yaml
name: Kimi Code
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  kimi:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@kimi')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@kimi')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@kimi')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@kimi') || contains(github.event.issue.title, '@kimi')))
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
      actions: read # lets the agent read CI results on PRs
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1
      - uses: xuwenhao/kimi-code-action@v0
        with:
          kimi_api_key: ${{ secrets.KIMI_API_KEY }}
```

3. Comment `@kimi what does the auth module do?` on any issue or PR.

See [`examples/`](./examples) for more patterns: PR auto-review with progress tracking, filtered
reviews, issue triage/dedup, CI auto-fix, and more.

## Inputs at a glance

| Input                                                     | Default                            | Purpose                                                              |
| --------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `kimi_api_key`                                            | —                                  | **Required.** Moonshot API key (`secrets.KIMI_API_KEY`)              |
| `kimi_model`                                              | `k3`                               | Model name used for the run                                          |
| `kimi_platform`                                           | `code`                             | Key/endpoint preset: `code` (Kimi Code), `open-cn`, `open-intl`      |
| `kimi_base_url`                                           | follows `kimi_platform`            | Explicit API endpoint; overrides the preset when set                 |
| `kimi_version`                                            | `latest`                           | kimi-code CLI version to install                                     |
| `prompt`                                                  | —                                  | Automation instructions; presence switches to agent mode             |
| `trigger_phrase`                                          | `@kimi`                            | Mention that wakes the agent in tag mode                             |
| `kimi_args`                                               | —                                  | Extra CLI flags (`--allowedTools`, `--max-turns`, `--mcp-config`, …) |
| `settings`                                                | —                                  | kimi `config.toml` fragment (inline or file path)                    |
| `github_token`                                            | `github.token`                     | Token for comments/branch pushes                                     |
| `use_sticky_comment`                                      | `false`                            | Reuse one tracking comment instead of creating new ones              |
| `classify_inline_comments`                                | `true`                             | Filter out test/probe inline comments before posting                 |
| `use_commit_signing`                                      | `false`                            | Sign commits via the GitHub API                                      |
| `ssh_signing_key`                                         | —                                  | Sign commits with this SSH private key instead                       |
| `bot_id` / `bot_name`                                     | `41898282` / `github-actions[bot]` | Git identity used for commits                                        |
| `track_progress`                                          | `false`                            | Force tag mode (tracking comment) on PR/issue events                 |
| `branch_prefix`                                           | `kimi/`                            | Prefix for branches the agent creates                                |
| `allowed_bots`                                            | —                                  | Bot logins allowed to trigger the action                             |
| `include_comments_by_actor` / `exclude_comments_by_actor` | —                                  | Filter which actors' comments reach the agent                        |
| `path_to_kimi_executable` / `path_to_bun_executable`      | —                                  | Bring your own binaries                                              |
| `display_report` / `show_full_output`                     | `false`                            | Step-summary report / verbose raw output (debug only)                |

Outputs: `execution_file`, `branch_name`, `github_token`, `session_id`.
Full reference: [docs/usage.md](./docs/usage.md) and [docs/configuration.md](./docs/configuration.md).

## Authentication

Only one secret is needed: `KIMI_API_KEY`. The action sets `KIMI_MODEL_NAME` / `KIMI_MODEL_API_KEY`
(plus optional `KIMI_MODEL_BASE_URL`) for the CLI from `kimi_model` / `kimi_api_key` / `kimi_base_url`.
GitHub operations use `github.token` by default — there is no GitHub App, OIDC exchange, or cloud
provider configuration. Details: [docs/setup.md](./docs/setup.md).

## Differences from upstream

`kimi-code-action` tracks the upstream feature set but drops everything tied to Anthropic-specific
infrastructure:

- **No OIDC → App token exchange, no workload identity federation** — `github.token` is used directly
- **No cloud providers** — Bedrock/Vertex/Foundry inputs are gone; the model endpoint is `kimi_base_url`
- **No `allowed_non_write_users`** — actors without write access are always rejected
- **No structured output** (`--json-schema`) — see [the FAQ](./docs/faq.md) for the prompt-and-parse alternative
- **No plugin system** (`plugins` / `plugin_marketplaces`)
- **No "Fix this" links** (they pointed at claude.ai)

Everything else — mode detection, tracking comments, inline PR comments, sticky comments, commit
signing, branch management, TOCTOU comment filtering, output sanitization, config restore — is
inherited and adapted. See [NOTICE](./NOTICE) for attribution.

## Documentation

- [Usage Guide](./docs/usage.md) — basic usage, workflow configuration, inputs
- [Configuration](./docs/configuration.md) — `kimi_args` flag mapping, permission rules, MCP servers, settings
- [Solutions Guide](./docs/solutions.md) — ready-to-use automation patterns
- [Custom Automations](./docs/custom-automations.md) — event-driven automation examples
- [Setup Guide](./docs/setup.md) — secrets, permissions, custom setups
- [Capabilities & Limitations](./docs/capabilities-and-limitations.md) — what the agent can and cannot do
- [Security](./docs/security.md) — access control, permission rules, commit signing
- [FAQ](./docs/faq.md) — common questions and troubleshooting

## License

MIT — see [LICENSE](./LICENSE). Adapted from claude-code-action (MIT); see [NOTICE](./NOTICE).
