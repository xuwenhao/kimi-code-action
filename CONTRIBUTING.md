# Contributing to Kimi Code Action

Thank you for your interest in contributing to Kimi Code Action! This document provides
guidelines and instructions for contributing to the project.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime (the action code runs on Bun)
- [Node.js](https://nodejs.org/) 24+ (the kimi-code CLI runs on Node)
- A Moonshot API key (for manual/e2e testing; unit tests don't need it)

### Setup

1. Fork the repository on GitHub and clone your fork:

   ```bash
   git clone https://github.com/your-username/kimi-code-action.git
   cd kimi-code-action
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. (Optional, for e2e only) set up your API key:
   ```bash
   export KIMI_API_KEY="your-api-key-here"
   ```

## Development

### Available Scripts

- `bun test` - Run all unit tests
- `bun run typecheck` - Type check the code
- `bun run format` - Format code with Prettier
- `bun run format:check` - Check code formatting

Also read [AGENTS.md](./AGENTS.md) — it documents the architecture, security invariants, and
repo conventions that CI and reviewers will hold your change to.

## Testing

### Running Tests Locally

```bash
bun test
bun run typecheck
bun run format:check
```

All three must pass. Unit tests live in `test/` and `base-action/test/`; they need no network or
API key (external calls are mocked, and the `run-kimi` tests use a fake `kimi` shell script).

End-to-end workflows (`.github/workflows/test-*.yml`) run only when the `E2E_ENABLED` repository
variable is `true` and a `KIMI_API_KEY` secret is configured — they are skipped by default.

## Pull Request Process

1. Create a new branch from `main`:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and commit them (conventional commits):

   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

3. Run tests and formatting:

   ```bash
   bun test
   bun run typecheck
   bun run format:check
   ```

4. Push your branch and create a Pull Request:

   ```bash
   git push origin feature/your-feature-name
   ```

5. Ensure all CI checks pass

6. Request review from maintainers

## Action Development

### Testing Your Changes

When modifying the action:

1. Test in a real GitHub Actions workflow by:
   - Creating a test repository
   - Adding a `KIMI_API_KEY` secret
   - Using your branch as the action source:
     ```yaml
     uses: your-username/kimi-code-action@your-branch
     ```

### Debugging

- Use `console.log` for debugging in development
- Check GitHub Actions logs for runtime issues
- The execution file (`execution_file` output) contains the full JSONL stream of a run
- `display_report: true` renders a Step Summary; avoid `show_full_output` outside private repos
