#!/usr/bin/env bun

/**
 * Resolve the GitHub token used by the action.
 *
 * Priority:
 *   1. OVERRIDE_GITHUB_TOKEN (the action's `github_token` input)
 *   2. DEFAULT_WORKFLOW_TOKEN (the workflow's `github.token`)
 * Throws when neither is available.
 */
export async function setupGitHubToken(): Promise<string> {
  const providedToken = process.env.OVERRIDE_GITHUB_TOKEN;

  if (providedToken) {
    console.log("Using provided GITHUB_TOKEN for authentication");
    return providedToken;
  }

  const workflowToken = process.env.DEFAULT_WORKFLOW_TOKEN;
  if (workflowToken) {
    console.log("Using github.token from the workflow for authentication");
    return workflowToken;
  }

  throw new Error(
    "No GitHub token available. Provide the `github_token` input or ensure `github.token` is set.",
  );
}
