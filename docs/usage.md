# Usage Guide

## Basic Usage

Add the action to a workflow and mention `@kimi` anywhere in an issue or PR:

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

The only required configuration is the `KIMI_API_KEY` secret (get one from
[platform.moonshot.ai](https://platform.moonshot.ai) or
[platform.kimi.com](https://platform.kimi.com)).

## How modes work

The action picks a mode automatically — there is no mode input:

- **Tag mode** — no `prompt` input, and the event contains the trigger phrase (default `@kimi`),
  an assignee trigger, or a label trigger. The agent creates a tracking comment and keeps it
  updated with a progress checklist.
- **Agent mode** — `prompt` input is non-empty. The agent runs the prompt directly with no
  tracking comment, suited for automation (scheduled jobs, PR auto-review, workflow_dispatch).
- **`track_progress: true`** — forces tag mode (tracking comment) for `pull_request` and
  `issues` events even though no mention is present.

Only the trigger comment is treated as instructions. Other comments, the issue/PR body, and
repository files are context — this is the prompt-injection defense line and it is always on.

## Inputs

| Input                       | Default                 | Description                                                                                                                            |
| --------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `kimi_api_key`              | —                       | API key from the Kimi Code Console (subscription) or Open Platform. Required unless `KIMI_MODEL_API_KEY` is set in the environment.    |
| `kimi_model`                | `k3`                    | Model name; becomes `KIMI_MODEL_NAME` for the CLI. `k3` requires a Moderato plan or above.                                             |
| `kimi_platform`             | `code`                  | Key/endpoint preset: `code` (Kimi Code Console), `open-cn` (platform.moonshot.cn), `open-intl` (platform.kimi.com).                    |
| `kimi_base_url`             | follows `kimi_platform` | API base URL; becomes `KIMI_MODEL_BASE_URL`. Explicit value overrides the `kimi_platform` preset (e.g. enterprise proxies).            |
| `kimi_version`              | `latest`                | kimi-code CLI version to install (`npm i -g @moonshot-ai/kimi-code@<version>`).                                                        |
| `prompt`                    | `""`                    | Automation instructions. Non-empty switches to agent mode.                                                                             |
| `trigger_phrase`            | `@kimi`                 | Phrase that triggers tag mode in comments/issue bodies.                                                                                |
| `assignee_trigger`          | `""`                    | Assignee username that triggers the action (e.g. `kimi-bot`).                                                                          |
| `label_trigger`             | `kimi`                  | Label that triggers the action on issues.                                                                                              |
| `base_branch`               | repo default            | Base/source branch when creating new branches.                                                                                         |
| `branch_prefix`             | `kimi/`                 | Prefix for branches the agent creates.                                                                                                 |
| `branch_name_template`      | `""`                    | Custom branch naming (`{{prefix}}`, `{{entityType}}`, `{{entityNumber}}`, `{{timestamp}}`, `{{sha}}`, `{{label}}`, `{{description}}`). |
| `allowed_bots`              | `""`                    | Bot logins allowed to trigger (`*` = all; empty = none). See [security.md](./security.md).                                             |
| `include_comments_by_actor` | `""`                    | Only these actors' comments are included as context.                                                                                   |
| `exclude_comments_by_actor` | `""`                    | These actors' comments are excluded from context (wins over include).                                                                  |
| `settings`                  | `""`                    | kimi `config.toml` fragment — inline TOML text or path to a `.toml` file.                                                              |
| `github_token`              | `github.token`          | Token used for comments and branch operations. Needs `contents`/`pull-requests`/`issues` write for full functionality.                 |
| `kimi_args`                 | `""`                    | Extra flags for the kimi CLI. See [configuration.md](./configuration.md) for the mapping table.                                        |
| `use_sticky_comment`        | `false`                 | Reuse a single tracking comment per PR instead of creating new ones.                                                                   |
| `classify_inline_comments`  | `true`                  | Buffer inline review comments and classify them (real vs test/probe) before posting.                                                   |
| `use_commit_signing`        | `false`                 | Sign commits via the GitHub API (shows "Verified").                                                                                    |
| `ssh_signing_key`           | `""`                    | SSH private key for commit signing; takes precedence over `use_commit_signing`.                                                        |
| `bot_id`                    | `41898282`              | Git user ID for commits (default: github-actions[bot]).                                                                                |
| `bot_name`                  | `github-actions[bot]`   | Git username for commits.                                                                                                              |
| `track_progress`            | `false`                 | Force tag mode with a tracking comment for PR/issue events.                                                                            |
| `path_to_kimi_executable`   | `""`                    | Custom kimi binary; skips installation.                                                                                                |
| `path_to_bun_executable`    | `""`                    | Custom Bun binary; skips installation.                                                                                                 |
| `display_report`            | `false`                 | Write the Kimi Code Report to the GitHub Step Summary.                                                                                 |
| `show_full_output`          | `false`                 | Print the full stream-json output (may contain secrets — debug only).                                                                  |

## Outputs

| Output           | Description                                                                |
| ---------------- | -------------------------------------------------------------------------- |
| `execution_file` | Path to the agent execution log (JSONL, one stream-json message per line). |
| `branch_name`    | Branch the agent created or pushed to.                                     |
| `github_token`   | The GitHub token the action used.                                          |
| `session_id`     | kimi session ID; continue the conversation with `kimi -r <session_id>`.    |

## Common recipes

**Custom trigger and model:**

```yaml
- uses: xuwenhao/kimi-code-action@v0
  with:
    kimi_api_key: ${{ secrets.KIMI_API_KEY }}
    trigger_phrase: "/kimi"
    kimi_model: k3
```

**PR auto-review with progress tracking** (no mention needed):

```yaml
on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened]

# ...
- uses: xuwenhao/kimi-code-action@v0
  with:
    kimi_api_key: ${{ secrets.KIMI_API_KEY }}
    track_progress: true
    prompt: |
      Review this PR for correctness, security issues, and test coverage.
```

See [`examples/pr-review-comprehensive.yml`](../examples/pr-review-comprehensive.yml) for the
complete workflow, and [docs/solutions.md](./solutions.md) for more patterns.

**Restrict the agent's tools:**

```yaml
- uses: xuwenhao/kimi-code-action@v0
  with:
    kimi_api_key: ${{ secrets.KIMI_API_KEY }}
    prompt: "Triage this issue (labels only, no code changes)"
    kimi_args: |
      --allowedTools "Bash(gh label list),Bash(gh issue edit:*)"
      --max-turns 10
```

`--allowedTools` / `--disallowedTools` become kimi permission rules; Claude-style tool names are
translated automatically. Full mapping: [configuration.md](./configuration.md#kimi_args-flag-mapping).
