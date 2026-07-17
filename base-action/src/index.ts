#!/usr/bin/env bun

import * as core from "@actions/core";
import { preparePrompt } from "./prepare-prompt";
import { runKimi } from "./run-kimi";
import { loadKimiSettingsFragment } from "./setup-kimi-settings";
import { validateEnvironmentVariables } from "./validate-env";
import { setExecutionFileOutputIfPresent } from "./execution-file";

async function run() {
  try {
    validateEnvironmentVariables();

    // The composite action's "Install kimi-code CLI" step puts kimi on PATH.
    // A custom executable path (if provided) takes precedence.
    const kimiExecutable = process.env.INPUT_PATH_TO_KIMI_EXECUTABLE || "kimi";

    const settingsFragment = await loadKimiSettingsFragment(
      process.env.INPUT_SETTINGS,
    );

    const promptConfig = await preparePrompt({
      prompt: process.env.INPUT_PROMPT || "",
      promptFile: process.env.INPUT_PROMPT_FILE || "",
    });

    const result = await runKimi(promptConfig.path, {
      kimiArgs: process.env.INPUT_KIMI_ARGS,
      allowedTools: process.env.INPUT_ALLOWED_TOOLS,
      disallowedTools: process.env.INPUT_DISALLOWED_TOOLS,
      maxTurns: process.env.INPUT_MAX_TURNS,
      mcpConfig: process.env.INPUT_MCP_CONFIG,
      appendSystemPrompt: process.env.INPUT_APPEND_SYSTEM_PROMPT,
      pathToKimiExecutable: kimiExecutable,
      settingsFragment,
      showFullOutput: process.env.INPUT_SHOW_FULL_OUTPUT,
    });

    // Set outputs for the standalone base-action
    core.setOutput("conclusion", result.conclusion);
    if (result.executionFile) {
      core.setOutput("execution_file", result.executionFile);
    }
    if (result.sessionId) {
      core.setOutput("session_id", result.sessionId);
    }
  } catch (error) {
    setExecutionFileOutputIfPresent();
    core.setFailed(`Action failed with error: ${error}`);
    core.setOutput("conclusion", "failure");
    process.exit(1);
  }
}

if (import.meta.main) {
  run();
}
