#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as core from "@actions/core";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runKimi } from "../src/run-kimi";

/**
 * Builds a fake `kimi` executable (a shell script) in <tempDir>/bin that
 * prints the given lines to stdout and exits with the given code.
 */
async function makeFakeKimi(binDir: string, scriptBody: string): Promise<void> {
  await mkdir(binDir, { recursive: true });
  const scriptPath = join(binDir, "kimi");
  await writeFile(scriptPath, `#!/bin/sh\n${scriptBody}\n`);
  await chmod(scriptPath, 0o755);
}

function echoLine(json: string): string {
  return `echo '${json}'`;
}

describe("runKimi", () => {
  const originalRunnerTemp = process.env.RUNNER_TEMP;
  const originalPath = process.env.PATH;
  let tempDir: string | undefined;
  let promptPath: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let warningSpy: any;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kimi-run-"));
    process.env.RUNNER_TEMP = tempDir;
    promptPath = join(tempDir, "prompt.txt");
    await writeFile(promptPath, "test prompt");

    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    warningSpy = spyOn(core, "warning").mockImplementation(() => {});
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    if (originalRunnerTemp === undefined) {
      delete process.env.RUNNER_TEMP;
    } else {
      process.env.RUNNER_TEMP = originalRunnerTemp;
    }
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    delete process.env.INPUT_PATH_TO_KIMI_EXECUTABLE;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    warningSpy.mockRestore();
  });

  function useFakeKimiOnPath(): void {
    process.env.PATH = `${join(tempDir!, "bin")}:${originalPath}`;
  }

  test("succeeds on exit 0 with assistant content and captures session_id", async () => {
    await makeFakeKimi(
      join(tempDir!, "bin"),
      [
        echoLine(
          '{"role":"assistant","content":"Working on it.","tool_calls":[{"type":"function","id":"tool_1","function":{"name":"Bash","arguments":"{\\"command\\":\\"ls\\"}"}}]}',
        ),
        echoLine(
          '{"role":"tool","tool_call_id":"tool_1","content":"file1.txt"}',
        ),
        echoLine('{"role":"assistant","content":"All done."}'),
        echoLine(
          '{"role":"meta","type":"session.resume_hint","session_id":"session_abc123","command":"kimi -r session_abc123"}',
        ),
      ].join("\n"),
    );
    useFakeKimiOnPath();

    const result = await runKimi(promptPath, {});

    expect(result.conclusion).toBe("success");
    expect(result.sessionId).toBe("session_abc123");
    expect(result.executionFile).toBeDefined();

    const executionContent = await readFile(result.executionFile!, "utf-8");
    const lines = executionContent.trim().split("\n");
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('"role":"assistant"');
    expect(lines[3]).toContain("session_abc123");
  });

  test("treats a denied tool call as success (exit 0 with assistant response)", async () => {
    await makeFakeKimi(
      join(tempDir!, "bin"),
      [
        echoLine(
          '{"role":"assistant","content":"Trying.","tool_calls":[{"type":"function","id":"tool_9","function":{"name":"Bash","arguments":"{\\"command\\":\\"touch denied.txt\\"}"}}]}',
        ),
        echoLine(
          '{"role":"tool","tool_call_id":"tool_9","content":"Tool \\"Bash\\" was denied by permission rule. Reason: test deny"}',
        ),
        echoLine('{"role":"assistant","content":"It was denied, reporting."}'),
        echoLine(
          '{"role":"meta","type":"session.resume_hint","session_id":"session_denied"}',
        ),
      ].join("\n"),
    );
    useFakeKimiOnPath();

    const result = await runKimi(promptPath, {});

    expect(result.conclusion).toBe("success");
    expect(result.sessionId).toBe("session_denied");
  });

  test("throws on non-zero exit code", async () => {
    await makeFakeKimi(
      join(tempDir!, "bin"),
      [echoLine('{"role":"assistant","content":"failing..."}'), "exit 1"].join(
        "\n",
      ),
    );
    useFakeKimiOnPath();

    await expect(runKimi(promptPath, {})).rejects.toThrow(
      "kimi execution failed with exit code 1",
    );
  });

  test("throws when exit 0 but no assistant content", async () => {
    await makeFakeKimi(
      join(tempDir!, "bin"),
      [
        echoLine('{"role":"tool","tool_call_id":"tool_1","content":"output"}'),
        echoLine(
          '{"role":"meta","type":"session.resume_hint","session_id":"session_empty"}',
        ),
      ].join("\n"),
    );
    useFakeKimiOnPath();

    await expect(runKimi(promptPath, {})).rejects.toThrow(
      "no assistant response",
    );
  });

  test("succeeds without a meta line (session_id unset, warning only)", async () => {
    await makeFakeKimi(
      join(tempDir!, "bin"),
      [echoLine('{"role":"assistant","content":"done without meta"}')].join(
        "\n",
      ),
    );
    useFakeKimiOnPath();

    const result = await runKimi(promptPath, {});

    expect(result.conclusion).toBe("success");
    expect(result.sessionId).toBeUndefined();
    expect(warningSpy).toHaveBeenCalledWith(
      expect.stringContaining("No session metadata found"),
    );
  });

  test("skips non-JSON lines with a warning", async () => {
    await makeFakeKimi(
      join(tempDir!, "bin"),
      [
        "echo 'this is not json'",
        echoLine('{"role":"assistant","content":"real answer"}'),
        echoLine(
          '{"role":"meta","type":"session.resume_hint","session_id":"session_dirty"}',
        ),
      ].join("\n"),
    );
    useFakeKimiOnPath();

    const result = await runKimi(promptPath, {});

    expect(result.conclusion).toBe("success");
    expect(result.sessionId).toBe("session_dirty");
    expect(warningSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping non-JSON line"),
    );
    // Raw lines (including the dirty one) are preserved in the execution file
    const content = await readFile(result.executionFile!, "utf-8");
    expect(content).toContain("this is not json");
  });

  test("scrubs OIDC env vars and sets an isolated KIMI_CODE_HOME", async () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://oidc.example/token";
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "secret-oidc-token";
    await makeFakeKimi(
      join(tempDir!, "bin"),
      [
        'echo "{\\"role\\":\\"assistant\\",\\"content\\":\\"home=$KIMI_CODE_HOME oidc=${ACTIONS_ID_TOKEN_REQUEST_URL:-unset} telemetry=$KIMI_DISABLE_TELEMETRY\\"}"',
        echoLine(
          '{"role":"meta","type":"session.resume_hint","session_id":"session_env"}',
        ),
      ].join("\n"),
    );
    useFakeKimiOnPath();

    const result = await runKimi(promptPath, {});

    expect(result.conclusion).toBe("success");
    const content = await readFile(result.executionFile!, "utf-8");
    // OIDC request vars are stripped from the subprocess environment
    expect(content).toContain("oidc=unset");
    expect(content).not.toContain("oidc.example");
    // KIMI_CODE_HOME points at a generated home with a config.toml, telemetry off
    expect(content).toContain("telemetry=1");
    const homeMatch = content.match(/home=(\S+?) oidc=/);
    expect(homeMatch).not.toBeNull();
    const configToml = await readFile(
      join(homeMatch![1]!, "config.toml"),
      "utf-8",
    );
    expect(configToml).toContain("[[permission.rules]]");
  });

  test("assembles prompt with appendSystemPrompt first and user request last", async () => {
    await writeFile(
      join(tempDir!, "kimi-user-request.txt"),
      "USER-REQUEST-MARKER",
    );
    const capturePath = join(tempDir!, "captured-prompt.txt");
    await makeFakeKimi(
      join(tempDir!, "bin"),
      [
        "# $2 is the prompt text (argv after -p)",
        `printf '%s' "$2" > ${capturePath}`,
        echoLine('{"role":"assistant","content":"ok"}'),
      ].join("\n"),
    );
    useFakeKimiOnPath();

    await runKimi(promptPath, {
      appendSystemPrompt: "SYSTEM-PROMPT-MARKER",
    });

    const captured = await readFile(capturePath, "utf-8");
    expect(captured.indexOf("SYSTEM-PROMPT-MARKER")).toBeLessThan(
      captured.indexOf("test prompt"),
    );
    expect(captured.indexOf("test prompt")).toBeLessThan(
      captured.indexOf("USER-REQUEST-MARKER"),
    );
  });

  test("writes permission rules and mcp servers into the generated home", async () => {
    const captureHome = join(tempDir!, "captured-home.txt");
    await makeFakeKimi(
      join(tempDir!, "bin"),
      [
        `echo "$KIMI_CODE_HOME" > ${captureHome}`,
        echoLine('{"role":"assistant","content":"ok"}'),
      ].join("\n"),
    );
    useFakeKimiOnPath();

    await runKimi(promptPath, {
      kimiArgs:
        '--allowedTools "Read,WebFetch" --disallowedTools "Bash(rm:*)" --max-turns 5',
      mcpConfig: '{"mcpServers":{"github_comment":{"command":"bun"}}}',
    });

    const home = (await readFile(captureHome, "utf-8")).trim();
    const configToml = await readFile(join(home, "config.toml"), "utf-8");
    // Default denies, then user deny, then user allows; tool names translated
    expect(configToml).toContain('pattern = "Write(.github/workflows/**)"');
    expect(configToml).toContain('pattern = "Bash(rm*)"');
    expect(configToml).toContain('pattern = "Read"');
    expect(configToml).toContain('pattern = "FetchURL"');
    expect(configToml.indexOf('pattern = "Bash(rm*)"')).toBeLessThan(
      configToml.indexOf('pattern = "Read"'),
    );
    expect(configToml).toContain("max_steps_per_turn = 5");

    const mcpJson = JSON.parse(await readFile(join(home, "mcp.json"), "utf-8"));
    expect(mcpJson).toEqual({
      mcpServers: { github_comment: { command: "bun" } },
    });
  });

  test("passes extra args through to the CLI", async () => {
    const captureArgs = join(tempDir!, "captured-args.txt");
    await makeFakeKimi(
      join(tempDir!, "bin"),
      [
        'echo "$@" > ' + captureArgs,
        echoLine('{"role":"assistant","content":"ok"}'),
      ].join("\n"),
    );
    useFakeKimiOnPath();

    await runKimi(promptPath, { kimiArgs: "--model kimi-k2 --verbose" });

    const captured = await readFile(captureArgs, "utf-8");
    expect(captured).toContain("-p");
    expect(captured).toContain("--output-format stream-json");
    expect(captured).toContain("--model kimi-k2");
    expect(captured).toContain("--verbose");
  });

  test("prefers INPUT_PATH_TO_KIMI_EXECUTABLE over PATH lookup", async () => {
    // Fake "kimi" on PATH that would fail the run if used
    await makeFakeKimi(join(tempDir!, "bin"), "exit 1");
    useFakeKimiOnPath();

    // Explicit executable that succeeds
    const explicitDir = join(tempDir!, "explicit");
    await mkdir(explicitDir, { recursive: true });
    const explicitKimi = join(explicitDir, "kimi-custom");
    await writeFile(
      explicitKimi,
      `#!/bin/sh\n${echoLine('{"role":"assistant","content":"via custom"}')}\n`,
    );
    await chmod(explicitKimi, 0o755);
    process.env.INPUT_PATH_TO_KIMI_EXECUTABLE = explicitKimi;

    const result = await runKimi(promptPath, {});

    expect(result.conclusion).toBe("success");
  });
});
