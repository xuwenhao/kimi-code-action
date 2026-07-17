# Custom Automations

These examples show how to configure the agent to act automatically based on GitHub events. When
you provide a `prompt` input, the action runs in agent mode without requiring manual @mentions.
Without a `prompt`, it runs in interactive tag mode, responding to @kimi mentions.

## Mode Detection & Tracking Comments

The action automatically detects which mode to use based on your configuration:

- **Interactive Mode** (no `prompt` input): responds to @kimi mentions, creates tracking comments
  with progress indicators
- **Automation Mode** (with `prompt` input): executes immediately, **does not create tracking
  comments**

> **Note**: automation mode intentionally does not create tracking comments by default to reduce
> noise in automated workflows. If you need progress tracking on PR/issue events, use
> `track_progress: true`.

## Supported GitHub Events

This action supports the following GitHub events ([learn more about GitHub event triggers](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows)):

- `pull_request` or `pull_request_target` - when PRs are opened or synchronized
- `issue_comment` - when comments are created on issues or PRs
- `issues` - when issues are opened, edited, labeled, or assigned
- `pull_request_review` - when PR reviews are submitted
- `pull_request_review_comment` - when comments are made on PR reviews
- `repository_dispatch` - custom events triggered via API
- `workflow_dispatch` - manual workflow triggers
- `workflow_run` / `schedule` - follow-up and scheduled automation (agent mode)

## Automated Documentation Updates

Automatically update documentation when specific files change (see
[`examples/pr-review-filtered-paths.yml`](../examples/pr-review-filtered-paths.yml)):

```yaml
on:
  pull_request:
    paths:
      - "src/api/**/*.ts"

steps:
  - uses: xuwenhao/kimi-code-action@v0
    with:
      kimi_api_key: ${{ secrets.KIMI_API_KEY }}
      prompt: |
        Update the API documentation in README.md to reflect
        the changes made to the API endpoints in this PR.
```

When API files are modified, the action detects that a `prompt` is provided and runs in agent
mode. The agent updates your README with the latest endpoint documentation and pushes the changes
back to the PR, keeping your docs in sync with your code.

## Author-Specific Code Reviews

Automatically review PRs from specific authors or external contributors (see
[`examples/pr-review-filtered-authors.yml`](../examples/pr-review-filtered-authors.yml)):

```yaml
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review-by-author:
    if: |
      github.event.pull_request.user.login == 'developer1' ||
      github.event.pull_request.user.login == 'external-contributor'
    steps:
      - uses: xuwenhao/kimi-code-action@v0
        with:
          kimi_api_key: ${{ secrets.KIMI_API_KEY }}
          prompt: |
            Please provide a thorough review of this pull request.
            Pay extra attention to coding standards, security practices,
            and test coverage since this is from an external contributor.
```

Perfect for automatically reviewing PRs from new team members, external contributors, or specific
developers who need extra guidance. The action runs in agent mode when a `prompt` is provided.

## Custom Prompt Templates

Use the `prompt` input with GitHub context variables for dynamic automation:

```yaml
- uses: xuwenhao/kimi-code-action@v0
  with:
    kimi_api_key: ${{ secrets.KIMI_API_KEY }}
    prompt: |
      Analyze PR #${{ github.event.pull_request.number }} in ${{ github.repository }} for security vulnerabilities.

      Focus on:
      - SQL injection risks
      - XSS vulnerabilities
      - Authentication bypasses
      - Exposed secrets or credentials

      Provide severity ratings (Critical/High/Medium/Low) for any issues found.
```

You can access any GitHub context variable using the standard GitHub Actions syntax:

- `${{ github.repository }}` - the repository name
- `${{ github.event.pull_request.number }}` - PR number
- `${{ github.event.issue.number }}` - issue number
- `${{ github.event.pull_request.title }}` - PR title
- `${{ github.event.pull_request.body }}` - PR description
- `${{ github.event.comment.body }}` - comment text
- `${{ github.actor }}` - user who triggered the workflow
- `${{ github.base_ref }}` - base branch for PRs
- `${{ github.head_ref }}` - head branch for PRs

## Advanced Configuration with kimi_args

For more control over the agent's behavior, use the `kimi_args` input to pass CLI arguments
directly:

```yaml
- uses: xuwenhao/kimi-code-action@v0
  with:
    kimi_api_key: ${{ secrets.KIMI_API_KEY }}
    prompt: "Review this PR for performance issues"
    kimi_args: |
      --max-turns 15
      --model k3
      --allowedTools Edit,Read,Write,Bash
      --append-system-prompt "You are a performance optimization expert. Focus on identifying bottlenecks and suggesting improvements."
```

`--allowedTools` / `--disallowedTools` become kimi permission rules (Claude-style tool names are
translated automatically), `--max-turns` caps the agent's steps per turn, and unknown flags pass
through to the kimi CLI. The full mapping table is in
[configuration.md](./configuration.md#kimi_args-flag-mapping).
