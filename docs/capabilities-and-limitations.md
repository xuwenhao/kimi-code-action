# Capabilities and Limitations

## What the Agent Can Do

- **Respond in a Single Comment**: the agent operates by updating a single initial comment with progress and results
- **Answer Questions**: analyze code and provide explanations
- **Implement Code Changes**: make simple to moderate code changes based on requests
- **Prepare Pull Requests**: creates commits on a branch and links back to a prefilled PR creation page
- **Perform Code Reviews**: analyze PR changes and provide detailed feedback, including inline comments on specific lines
- **Smart Branch Handling**:
  - When triggered on an **issue**: always creates a new branch for the work
  - When triggered on an **open PR**: always pushes directly to the existing PR branch
  - When triggered on a **closed PR**: creates a new branch since the original is no longer active
- **View GitHub Actions Results**: can access workflow runs, job logs, and test results on the PR where it's tagged when `actions: read` permission is configured (see [configuration](./configuration.md#mcp-servers))
- **Resume Sessions**: every run outputs a `session_id`; continue the conversation with `kimi -r`

## What the Agent Cannot Do

- **Submit PR Reviews**: the agent cannot submit formal GitHub PR reviews
- **Approve PRs**: for security reasons, the agent cannot approve pull requests
- **Post Multiple Comments**: the agent only acts by updating its initial comment
- **Execute Commands Outside Its Context**: the agent only has access to the repository and PR/issue context it's triggered in
- **Modify Workflow Files**: writes to `.github/workflows/` are denied by built-in permission rules
- **Force Push or Rebase**: git operations are limited to add/commit/push; force-push is denied
- **Produce Structured Outputs**: no `--json-schema` support — use prompt-and-parse instead (see [FAQ](./faq.md))
- **Perform Branch Operations**: cannot merge branches or perform other git operations beyond creating and pushing commits

## How It Works

1. **Trigger Detection**: listens for comments containing the trigger phrase (default: `@kimi`), issue assignment to a specific user, or a label
2. **Context Gathering**: analyzes the PR/issue, comments, and code changes
3. **Smart Responses**: either answers questions or implements changes
4. **Branch Management**: creates new branches for issues and closed PRs, pushes directly to open PR branches
5. **Communication**: posts updates to its tracking comment at every step

This action is derived from [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action)
(see [NOTICE](../NOTICE)), with the agent runtime replaced by the kimi-code CLI.
