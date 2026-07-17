# Setup Guide

## Standard setup (direct API)

1. **Get an API key** from the Moonshot open platform —
   [platform.moonshot.ai](https://platform.moonshot.ai) or
   [platform.kimi.com](https://platform.kimi.com).
2. **Add it as a repository secret** named `KIMI_API_KEY`
   (Settings → Secrets and variables → Actions → New repository secret).
3. **Copy a workflow** from [`examples/`](../examples) into `.github/workflows/` —
   [`examples/kimi.yml`](../examples/kimi.yml) is the standard @kimi setup.
4. Make sure the workflow's `permissions:` block grants what the workflow needs:

   ```yaml
   permissions:
     contents: write # push branches/commits (skip for read-only jobs)
     pull-requests: write # PR comments
     issues: write # issue comments/labels
     actions: read # CI status on PRs (optional but recommended)
   ```

That's it — no GitHub App, no OIDC configuration, no cloud provider setup. The action uses
`github.token` for GitHub operations and installs the kimi-code CLI from npm on each run
(`@moonshot-ai/kimi-code`, pin with `kimi_version`).

## Model and endpoint selection

- `kimi_model` (default `kimi-for-coding`) — the model the CLI uses; becomes `KIMI_MODEL_NAME`.
- `kimi_base_url` (default `https://api.kimi.com/coding/v1`) — becomes `KIMI_MODEL_BASE_URL`.
- `kimi_args: --model <alias>` also works, but the input is the recommended way.

**Which key goes with which endpoint** — there are two separate systems and their keys are
NOT interchangeable (mismatch = `401 Invalid Authentication`):

| Key source                              | `kimi_base_url`                            | `kimi_model`                |
| --------------------------------------- | ------------------------------------------ | --------------------------- |
| Kimi Code Console (subscription)        | `https://api.kimi.com/coding/v1` (default) | `kimi-for-coding` (default) |
| Open Platform CN (platform.moonshot.cn) | `https://api.moonshot.cn/v1`               | an Open Platform model id   |
| Open Platform intl (platform.kimi.com)  | `https://api.moonshot.ai/v1`               | an Open Platform model id   |

## Using a custom GitHub token or App

By default GitHub operations (comments, branch pushes) use the workflow's automatic
`github.token`, whose commits and comments appear as `github-actions[bot]`. To act under a
different identity:

```yaml
- uses: xuwenhao/kimi-code-action@v0
  with:
    kimi_api_key: ${{ secrets.KIMI_API_KEY }}
    github_token: ${{ secrets.MY_PAT_OR_APP_TOKEN }}
    bot_id: "12345678" # user ID of the token's owner
    bot_name: "my-bot[bot]" # login of the token's owner
```

`bot_id`/`bot_name` must match the token's owner — they set the git commit identity. A classic
PAT needs `repo` scope; a fine-grained PAT or App token needs contents/pull-requests/issues read
& write on the repo. The token is only used for GitHub API calls and git pushes; it is never sent
to the model provider.

## Pinning and offline considerations

- Pin the action itself by ref: `uses: xuwenhao/kimi-code-action@v0` (or a commit SHA).
- Pin the CLI: `kimi_version: 0.26.0`.
- Fully offline runners can pre-install both binaries and use `path_to_kimi_executable` and
  `path_to_bun_executable`.

## Security best practices

**Never hardcode credentials:**

```yaml
# ❌ WRONG - exposes your API key
kimi_api_key: sk-abc123

# ✅ CORRECT - uses GitHub secrets
kimi_api_key: ${{ secrets.KIMI_API_KEY }}
```

- Scope secrets to the repositories that need them; prefer environment protection rules for
  sensitive repos.
- Keep each workflow's `permissions:` minimal (see [security.md](./security.md)).
- Treat `show_full_output: true` as debug-only — the raw stream can contain secrets.

## Setting up GitHub secrets (recap)

1. Repo → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret** → name `KIMI_API_KEY`, paste the key → **Add secret**
3. Reference it as `${{ secrets.KIMI_API_KEY }}` in workflows

Organization-level secrets work the same way and can be shared across repos.
