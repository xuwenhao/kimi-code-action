import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { setupGitHubToken } from "../src/github/token";

describe("setupGitHubToken", () => {
  let originalOverrideToken: string | undefined;
  let originalWorkflowToken: string | undefined;

  beforeEach(() => {
    originalOverrideToken = process.env.OVERRIDE_GITHUB_TOKEN;
    originalWorkflowToken = process.env.DEFAULT_WORKFLOW_TOKEN;
    delete process.env.OVERRIDE_GITHUB_TOKEN;
    delete process.env.DEFAULT_WORKFLOW_TOKEN;
  });

  afterEach(() => {
    if (originalOverrideToken === undefined) {
      delete process.env.OVERRIDE_GITHUB_TOKEN;
    } else {
      process.env.OVERRIDE_GITHUB_TOKEN = originalOverrideToken;
    }

    if (originalWorkflowToken === undefined) {
      delete process.env.DEFAULT_WORKFLOW_TOKEN;
    } else {
      process.env.DEFAULT_WORKFLOW_TOKEN = originalWorkflowToken;
    }
  });

  test("prefers the override token when both are set", async () => {
    process.env.OVERRIDE_GITHUB_TOKEN = "override-token";
    process.env.DEFAULT_WORKFLOW_TOKEN = "workflow-token";

    await expect(setupGitHubToken()).resolves.toBe("override-token");
  });

  test("returns the override token when only it is set", async () => {
    process.env.OVERRIDE_GITHUB_TOKEN = "override-token";

    await expect(setupGitHubToken()).resolves.toBe("override-token");
  });

  test("falls back to the default workflow token", async () => {
    process.env.DEFAULT_WORKFLOW_TOKEN = "workflow-token";

    await expect(setupGitHubToken()).resolves.toBe("workflow-token");
  });

  test("treats an empty override token as unset", async () => {
    process.env.OVERRIDE_GITHUB_TOKEN = "";
    process.env.DEFAULT_WORKFLOW_TOKEN = "workflow-token";

    await expect(setupGitHubToken()).resolves.toBe("workflow-token");
  });

  test("throws when no token is available", async () => {
    await expect(setupGitHubToken()).rejects.toThrow(
      "No GitHub token available. Provide the `github_token` input or ensure `github.token` is set.",
    );
  });
});
