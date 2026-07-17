#!/usr/bin/env bun

/**
 * Unified entrypoint for the Kimi Code Action.
 * Merges all previously separate action.yml steps (prepare, install, run, cleanup)
 * into a single TypeScript orchestrator.
 */

import * as core from "@actions/core";
import { dirname } from "path";
import { spawn } from "child_process";
import { appendFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { setupGitHubToken } from "../github/token";
import { checkWritePermissions } from "../github/validation/permissions";
import { createOctokit } from "../github/api/client";
import type { Octokits } from "../github/api/client";
import {
  parseGitHubContext,
  isEntityContext,
  isPullRequestEvent,
  isPullRequestReviewEvent,
  isPullRequestReviewCommentEvent,
} from "../github/context";
import type { GitHubContext } from "../github/context";
import { detectMode } from "../modes/detector";
import { prepareTagMode } from "../modes/tag";
import { prepareAgentMode } from "../modes/agent";
import { checkContainsTrigger } from "../github/validation/trigger";
import { restoreConfigFromBase } from "../github/operations/restore-config";
import { validateBranchName } from "../github/operations/branch";
import { updateCommentLink } from "./update-comment-link";
import { formatTurnsFromData, parseExecutionLog } from "./format-turns";
// Base-action imports (used directly instead of subprocess)
import { validateEnvironmentVariables } from "../../base-action/src/validate-env";
import { loadKimiSettingsFragment } from "../../base-action/src/setup-kimi-settings";
import { preparePrompt } from "../../base-action/src/prepare-prompt";
import { runKimi } from "../../base-action/src/run-kimi";
import type { KimiRunResult } from "../../base-action/src/run-kimi";
import { setExecutionFileOutputIfPresent } from "../../base-action/src/execution-file";

/**
 * Verify a kimi executable is runnable via `--version`.
 */
async function verifyKimiVersion(executable: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ["--version"], { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`'${executable} --version' exited with code ${code}`));
    });
    child.on("error", (error) => {
      reject(
        new Error(`Failed to run '${executable} --version': ${error.message}`),
      );
    });
  });
}

/**
 * Install the kimi-code CLI, handling retry logic and custom executable paths.
 * Returns the executable to invoke (a custom path, or "kimi" resolved via PATH).
 */
async function installKimiCode(): Promise<string> {
  const customExecutable = process.env.PATH_TO_KIMI_EXECUTABLE;
  if (customExecutable) {
    if (/[\x00-\x1f\x7f]/.test(customExecutable)) {
      throw new Error(
        "PATH_TO_KIMI_EXECUTABLE contains control characters (e.g. newlines), which is not allowed",
      );
    }
    console.log(`Using custom kimi executable: ${customExecutable}`);
    const kimiDir = dirname(customExecutable);
    // Add to PATH by appending to GITHUB_PATH
    const githubPath = process.env.GITHUB_PATH;
    if (githubPath) {
      await appendFile(githubPath, `${kimiDir}\n`);
    }
    // Also add to current process PATH
    process.env.PATH = `${kimiDir}:${process.env.PATH}`;
    await verifyKimiVersion(customExecutable);
    return customExecutable;
  }

  const kimiVersion = process.env.KIMI_VERSION || "latest";
  console.log(
    `Installing kimi-code CLI (@moonshot-ai/kimi-code@${kimiVersion})...`,
  );

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`Installation attempt ${attempt}...`);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "npm",
          ["install", "-g", `@moonshot-ai/kimi-code@${kimiVersion}`],
          { stdio: "inherit" },
        );
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Install failed with exit code ${code}`));
        });
        child.on("error", reject);
      });
      console.log("kimi-code CLI installed successfully");
      await verifyKimiVersion("kimi");
      return "kimi";
    } catch (error) {
      if (attempt === 3) {
        throw new Error(
          `Failed to install kimi-code CLI after 3 attempts: ${error}`,
        );
      }
      console.log("Installation failed, retrying...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw new Error("unreachable");
}

/**
 * Write the step summary from kimi's execution output file (JSONL).
 */
async function writeStepSummary(executionFile: string): Promise<void> {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  try {
    const fileContent = readFileSync(executionFile, "utf-8");
    const data = parseExecutionLog(fileContent);
    const markdown = formatTurnsFromData(data);
    await appendFile(summaryFile, markdown);
    console.log("Successfully formatted Kimi Code report");
  } catch (error) {
    console.error(`Failed to format output: ${error}`);
    // Fall back to raw JSONL
    try {
      let fallback = "## Kimi Code Report (Raw Output)\n\n";
      fallback +=
        "Failed to format output (please report). Here's the raw output:\n\n";
      fallback += "```json\n";
      fallback += readFileSync(executionFile, "utf-8");
      fallback += "\n```\n";
      await appendFile(summaryFile, fallback);
    } catch {
      console.error("Failed to write raw output to step summary");
    }
  }
}

async function run() {
  let githubToken: string | undefined;
  let commentId: number | undefined;
  let kimiBranch: string | undefined;
  let baseBranch: string | undefined;
  let executionFile: string | undefined;
  let kimiSuccess = false;
  let prepareSuccess = true;
  let prepareError: string | undefined;
  let context: GitHubContext | undefined;
  let octokit: Octokits | undefined;
  // Track whether we've completed prepare phase, so we can attribute errors correctly
  let prepareCompleted = false;
  try {
    // Phase 1: Prepare
    context = parseGitHubContext();
    const modeName = detectMode(context);
    console.log(
      `Auto-detected mode: ${modeName} for event: ${context.eventName}`,
    );

    githubToken = await setupGitHubToken();

    octokit = createOctokit(githubToken);

    // Set GITHUB_TOKEN and GH_TOKEN in process env for downstream usage
    process.env.GITHUB_TOKEN = githubToken;
    process.env.GH_TOKEN = githubToken;

    // Check write permissions (only for entity contexts)
    if (isEntityContext(context)) {
      const hasWritePermissions = await checkWritePermissions(
        octokit.rest,
        context,
      );
      if (!hasWritePermissions) {
        throw new Error(
          "Actor does not have write permissions to the repository",
        );
      }
    }

    // Check trigger conditions
    const containsTrigger =
      modeName === "tag"
        ? isEntityContext(context) && checkContainsTrigger(context)
        : !!context.inputs?.prompt;
    console.log(`Mode: ${modeName}`);
    console.log(`Context prompt: ${context.inputs?.prompt || "NO PROMPT"}`);
    console.log(`Trigger result: ${containsTrigger}`);

    if (!containsTrigger) {
      console.log("No trigger found, skipping remaining steps");
      core.setOutput("github_token", githubToken);
      return;
    }

    // Run prepare
    console.log(
      `Preparing with mode: ${modeName} for event: ${context.eventName}`,
    );
    const prepareResult =
      modeName === "tag"
        ? await prepareTagMode({ context, octokit, githubToken })
        : await prepareAgentMode({ context, octokit, githubToken });

    commentId = prepareResult.commentId;
    kimiBranch = prepareResult.branchInfo.kimiBranch;
    baseBranch = prepareResult.branchInfo.baseBranch;
    prepareCompleted = true;

    // Phase 2: Install kimi-code CLI
    const kimiExecutable = await installKimiCode();

    // Phase 3: Run kimi (import base-action directly)
    validateEnvironmentVariables();

    // On PRs, .kimi-code/ and .mcp.json in the checkout are attacker-controlled.
    // Restore them from the base branch before the CLI reads them.
    //
    // We read pull_request.base.ref from the payload directly because agent
    // mode's branchInfo.baseBranch defaults to the repo's default branch rather
    // than the PR's actual target (agent/index.ts). For issue_comment on a PR the payload
    // lacks base.ref, so we fall back to the mode-provided value — tag mode
    // fetches it from GraphQL; agent mode on issue_comment is an edge case
    // that at worst restores from the wrong trusted branch (still secure).
    if (isEntityContext(context) && context.isPR) {
      let restoreBase = baseBranch;
      if (
        isPullRequestEvent(context) ||
        isPullRequestReviewEvent(context) ||
        isPullRequestReviewCommentEvent(context)
      ) {
        restoreBase = context.payload.pull_request.base.ref;
        validateBranchName(restoreBase);
      }
      if (restoreBase) {
        restoreConfigFromBase(restoreBase);
      }
    }

    const settingsFragment = await loadKimiSettingsFragment(
      process.env.INPUT_SETTINGS,
    );

    const promptFile =
      process.env.INPUT_PROMPT_FILE ||
      `${process.env.RUNNER_TEMP}/kimi-prompts/kimi-prompt.txt`;
    const promptConfig = await preparePrompt({
      prompt: "",
      promptFile,
    });

    const kimiResult: KimiRunResult = await runKimi(promptConfig.path, {
      kimiArgs: prepareResult.kimiArgs,
      appendSystemPrompt: process.env.APPEND_SYSTEM_PROMPT,
      pathToKimiExecutable: kimiExecutable,
      settingsFragment,
      showFullOutput: process.env.INPUT_SHOW_FULL_OUTPUT,
    });

    kimiSuccess = kimiResult.conclusion === "success";
    executionFile = kimiResult.executionFile;

    // Set action-level outputs
    if (kimiResult.executionFile) {
      core.setOutput("execution_file", kimiResult.executionFile);
    }
    if (kimiResult.sessionId) {
      core.setOutput("session_id", kimiResult.sessionId);
    }
    core.setOutput("conclusion", kimiResult.conclusion);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    executionFile ??= setExecutionFileOutputIfPresent();
    // Only mark as prepare failure if we haven't completed the prepare phase
    if (!prepareCompleted) {
      prepareSuccess = false;
      prepareError = errorMessage;
    }
    core.setFailed(`Action failed with error: ${errorMessage}`);
  } finally {
    // Phase 4: Cleanup (always runs)

    // Update tracking comment
    if (
      commentId &&
      context &&
      isEntityContext(context) &&
      githubToken &&
      octokit
    ) {
      try {
        await updateCommentLink({
          commentId,
          githubToken,
          kimiBranch,
          baseBranch: baseBranch || context.repository.default_branch || "main",
          triggerUsername: context.actor,
          context,
          octokit,
          kimiSuccess,
          outputFile: executionFile,
          prepareSuccess,
          prepareError,
          useCommitSigning: context.inputs.useCommitSigning,
        });
      } catch (error) {
        console.error("Error updating comment with job link:", error);
      }
    }

    // Write step summary (unless display_report is set to false)
    if (
      executionFile &&
      existsSync(executionFile) &&
      process.env.DISPLAY_REPORT !== "false"
    ) {
      await writeStepSummary(executionFile);
    }

    // Set remaining action-level outputs
    core.setOutput("branch_name", kimiBranch);
    core.setOutput("github_token", githubToken);
  }
}

if (import.meta.main) {
  run();
}
