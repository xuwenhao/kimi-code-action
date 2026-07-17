# Solutions & Use Cases

Ready-to-use automation patterns. Each links to a complete, working workflow in
[`examples/`](../examples) — copy it into `.github/workflows/` and adjust to taste.

## 📋 Table of Contents

- [Automatic PR Code Review](#automatic-pr-code-review)
- [Review Only Specific File Paths](#review-only-specific-file-paths)
- [Review PRs from External Contributors](#review-prs-from-external-contributors)
- [Custom PR Review Checklist](#custom-pr-review-checklist)
- [Scheduled Repository Maintenance](#scheduled-repository-maintenance)
- [Issue Auto-Triage and Labeling](#issue-auto-triage-and-labeling)
- [Issue Deduplication](#issue-deduplication)
- [Documentation Sync on API Changes](#documentation-sync-on-api-changes)
- [Security-Focused PR Reviews](#security-focused-pr-reviews)
- [CI Failure Auto-Fix](#ci-failure-auto-fix)
- [Gating Agent-Authored PRs on Human Approval](#gating-agent-authored-prs-on-human-approval)
- [Tips for All Solutions](#tips-for-all-solutions)

## Automatic PR Code Review

Review every PR as it's opened or updated — no mention needed.

**Workflow:** [`examples/pr-review-comprehensive.yml`](../examples/pr-review-comprehensive.yml)

```yaml
on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 1
      - uses: xuwenhao/kimi-code-action@v0
        with:
          kimi_api_key: ${{ secrets.KIMI_API_KEY }}
          track_progress: true # tracking comment with progress checkboxes
          prompt: |
            Review this PR: correctness, security, performance, tests, docs.
            Use inline comments for specific issues and the top-level
            comment for general observations.
          kimi_args: |
            --allowedTools "mcp__github_inline_comment__create_inline_comment,Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*)"
```

Without `track_progress` the run is silent (agent mode); with it the PR gets a live tracking
comment. Inline comments are buffered and classified (real review vs test/probe) before posting
unless you set `classify_inline_comments: "false"`.

## Review Only Specific File Paths

Trigger reviews only when critical paths change.

**Workflow:** [`examples/pr-review-filtered-paths.yml`](../examples/pr-review-filtered-paths.yml)

```yaml
on:
  pull_request:
    types: [opened, synchronize]
    paths:
      - "src/**/*.ts"
      - "api/**/*.py"
```

The workflow-level `paths:` filter does the gating, so you only spend tokens on PRs that touch
code you care about.

## Review PRs from External Contributors

Apply stricter review standards to specific authors.

**Workflow:** [`examples/pr-review-filtered-authors.yml`](../examples/pr-review-filtered-authors.yml)

```yaml
jobs:
  review-by-author:
    if: |
      github.event.pull_request.user.login == 'external-contributor'
```

Adjust the `if:` condition to author lists, association checks
(`github.event.pull_request.author_association == 'FIRST_TIME_CONTRIBUTOR'`), or team queries.

## Custom PR Review Checklist

Enforce team standards by spelling out the checklist in the prompt:

```yaml
prompt: |
  Review this PR against our checklist:
  - [ ] Migrations included for schema changes
  - [ ] New endpoints have OpenAPI docs
  - [ ] Errors use our AppError type
  - [ ] Tests cover the new code paths
  Check each item explicitly in your review and mark any violations.
```

## Scheduled Repository Maintenance

Periodic health checks with `schedule`:

```yaml
on:
  schedule:
    - cron: "0 9 * * 1" # Mondays 09:00 UTC

jobs:
  maintenance:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: xuwenhao/kimi-code-action@v0
        with:
          kimi_api_key: ${{ secrets.KIMI_API_KEY }}
          prompt: |
            Check for outdated dependencies, dead links in docs, and TODOs
            older than 6 months. Open ONE issue summarizing findings;
            do not change any code.
```

## Issue Auto-Triage and Labeling

**Workflow:** [`examples/issue-triage.yml`](../examples/issue-triage.yml)

Labels new issues using only the label tools (`gh label list`, `gh issue edit`), with tight
permissions (`issues: write` only). The actor must have write access — there is no bypass.

## Issue Deduplication

**Workflow:** [`examples/issue-deduplication.yml`](../examples/issue-deduplication.yml)

Searches existing issues via the GitHub MCP tools, comments and labels `duplicate` when a true
match is found, stays silent otherwise.

## Documentation Sync on API Changes

A `paths:` filter plus a prompt that rewrites the affected docs — see
[Custom Automations](./custom-automations.md#automated-documentation-updates).

## Security-Focused PR Reviews

OWASP-flavored review via prompt specialization:

```yaml
prompt: |
  Security review of this PR. Check: injection (SQL/command/template),
  authn/authz changes, secret handling, crypto misuse, unsafe
  deserialization, SSRF, path traversal. Rate each finding
  Critical/High/Medium/Low and reference file:line.
kimi_args: |
  --allowedTools "mcp__github_inline_comment__create_inline_comment,Bash(gh pr diff:*)"
```

## CI Failure Auto-Fix

**Workflow:** [`examples/ci-failure-auto-fix.yml`](../examples/ci-failure-auto-fix.yml)

On a failed `workflow_run`, creates a fix branch, pulls the failing job logs, and asks the agent
for a minimal fix. **Read the security warning in the file before enabling it** — it runs PR code
with write permissions.

## Gating Agent-Authored PRs on Human Approval

**Workflow:** [`examples/agent-approval-check.yml`](../examples/agent-approval-check.yml)
(independent Python action in [`agent-approval-check/`](../agent-approval-check))

Requires N human approvals on any PR containing agent-authored commits, as a required status
check. Useful once the agent starts pushing branches regularly.

## Tips for All Solutions

### Always include GitHub context

`${{ github.repository }}`, PR/issue numbers, and branch names in the prompt make the agent's
job much easier — it doesn't have to discover them.

### Common tool permissions

- Reviews: `mcp__github_inline_comment__create_inline_comment`, `Bash(gh pr diff:*)`, `Bash(gh pr view:*)`
- Issue work: `Bash(gh issue view:*)`, `Bash(gh issue edit:*)`, `Bash(gh label list)`
- Code changes: `Edit,Write,Read,Glob,Grep` plus scoped `Bash(...)` for builds/tests

### Best practices

- Prefer `--disallowedTools` for guardrails; auto permissions cover the rest.
- Keep `permissions:` minimal per job.
- Pin `kimi_version` after a workflow is proven.
- Give the agent an explicit "stay silent if nothing to do" instruction for noisy jobs.
