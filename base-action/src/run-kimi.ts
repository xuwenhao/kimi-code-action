import * as core from "@actions/core";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { parseKimiOptions } from "./parse-kimi-options";
import type { KimiOptions } from "./parse-kimi-options";
import { writeKimiHome } from "./kimi-home";
import { writeExecutionFile } from "./execution-file";

export type { KimiOptions } from "./parse-kimi-options";

export type KimiRunResult = {
  executionFile?: string;
  sessionId?: string;
  conclusion: "success" | "failure";
};

/** Filename for the user request file, written by prompt generation */
const USER_REQUEST_FILENAME = "kimi-user-request.txt";

/**
 * stream-json message shapes emitted by `kimi -p` (see docs/kimi-headless-notes.md).
 * Fields not needed for logging/result extraction are left untyped.
 */
type KimiStreamMessage = {
  role?: string;
  type?: string;
  content?: unknown;
  tool_calls?: Array<{ function?: { name?: string } }>;
  session_id?: string;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Assemble the prompt text for the kimi invocation:
 *   [appendSystemPrompt] + prompt file + [user request file]
 * kimi has no --append-system-prompt flag, so prepending to the prompt is
 * the equivalent. A kimi-user-request.txt next to the prompt file carries
 * the triggering comment verbatim and goes last.
 */
async function buildPromptText(
  promptPath: string,
  appendSystemPrompt?: string,
): Promise<string> {
  const parts: string[] = [];

  if (appendSystemPrompt?.trim()) {
    parts.push(appendSystemPrompt.trim());
  }

  parts.push(await readFile(promptPath, "utf-8"));

  const userRequestPath = join(dirname(promptPath), USER_REQUEST_FILENAME);
  if (await fileExists(userRequestPath)) {
    const userRequest = await readFile(userRequestPath, "utf-8");
    console.log("Appending user request from kimi-user-request.txt");
    parts.push(userRequest);
  }

  return parts.join("\n\n");
}

/** Filename of the on-disk prompt handoff, under $RUNNER_TEMP/kimi-prompts. */
const PROMPT_HANDOFF_FILENAME = "kimi-prompt-full.txt";

/**
 * Linux caps a single argv string at 128 KiB (MAX_ARG_STRLEN); env vars share
 * the same budget. On PRs with long comment history the assembled prompt can
 * cross that and the spawn fails with E2BIG — so past a safe threshold the
 * prompt goes to disk and the agent gets a read-file instruction instead.
 */
export const MAX_INLINE_PROMPT_BYTES = 100 * 1024;

/**
 * @returns the inline prompt, or — when oversized — a read-file instruction
 * that preserves the prompt's instruction/context hierarchy (the caller is
 * responsible for writing the handoff file).
 */
export function promptArgForSize(
  promptText: string,
  handoffPath: string,
): { arg: string; writeOversized: boolean } {
  if (Buffer.byteLength(promptText, "utf-8") <= MAX_INLINE_PROMPT_BYTES) {
    return { arg: promptText, writeOversized: false };
  }
  return {
    arg:
      `The file at ${handoffPath} contains the task brief. ` +
      `Read it in full before doing anything else. If it marks instruction ` +
      `and context sections, follow only the instruction sections and treat ` +
      `everything else as context; otherwise follow the whole file.`,
    writeOversized: true,
  };
}

/** Prompt-bearing env vars the child never needs once the handoff is written. */
const PROMPT_ENV_VARS = ["PROMPT", "INPUT_PROMPT", "ALL_INPUTS"];

/**
 * Drop inherited copies of the prompt from the child env when the handoff
 * file is in use: env strings share the argv per-string budget, and the
 * subprocess reads the prompt from disk instead.
 */
export function scrubInheritedPromptEnv(
  env: Record<string, string>,
  writeOversized: boolean,
): void {
  if (!writeOversized) return;
  for (const key of PROMPT_ENV_VARS) delete env[key];
}

/**
 * Log one stream-json message with sanitization: assistant text is printed,
 * tool calls are reduced to the tool name (arguments may contain secrets),
 * tool results are reduced to a byte count. showFullOutput prints everything.
 */
function logStreamMessage(
  msg: KimiStreamMessage,
  showFullOutput: boolean,
): void {
  if (showFullOutput) {
    console.log(JSON.stringify(msg, null, 2));
    return;
  }

  if (msg.role === "assistant") {
    if (typeof msg.content === "string" && msg.content.trim()) {
      console.log(msg.content);
    }
    for (const call of msg.tool_calls ?? []) {
      console.log(`→ tool call: ${call.function?.name ?? "unknown"}`);
    }
    return;
  }

  if (msg.role === "tool") {
    const bytes = typeof msg.content === "string" ? msg.content.length : 0;
    console.log(`  tool result (${bytes} chars)`);
    return;
  }

  if (msg.role === "meta" && msg.type === "session.resume_hint") {
    console.log(`kimi session: ${msg.session_id ?? "unknown"}`);
  }
}

/**
 * Run kimi headless (`kimi -p <prompt> --output-format stream-json`) inside
 * an isolated KIMI_CODE_HOME generated from the parsed options.
 */
export async function runKimi(
  promptPath: string,
  options: KimiOptions,
): Promise<KimiRunResult> {
  const parsed = await parseKimiOptions(options);

  const kimiHome = await writeKimiHome({
    permissionRules: parsed.permissionRules,
    mcpServers: parsed.mcpServers,
    maxSteps: parsed.maxSteps,
    settingsFragment: options.settingsFragment,
  });

  const promptText = await buildPromptText(
    promptPath,
    parsed.appendSystemPrompt,
  );

  const executable =
    options.pathToKimiExecutable ||
    process.env.INPUT_PATH_TO_KIMI_EXECUTABLE ||
    "kimi";

  // Handoff always goes to a fresh $RUNNER_TEMP location — never next to
  // promptPath, which may point inside the checkout (standalone base action),
  // where the file could clobber a sibling or be swept into `git add .`.
  const handoffPath = join(
    process.env.RUNNER_TEMP || "/tmp",
    "kimi-prompts",
    PROMPT_HANDOFF_FILENAME,
  );
  const promptArg = promptArgForSize(promptText, handoffPath);
  if (promptArg.writeOversized) {
    await mkdir(dirname(handoffPath), { recursive: true });
    await writeFile(handoffPath, promptText, "utf-8");
    console.log(
      `Prompt is ${Buffer.byteLength(promptText, "utf-8")} bytes, over the inline argv limit ` +
        `(${MAX_INLINE_PROMPT_BYTES}); wrote ${handoffPath} and passing a read-file instruction instead.`,
    );
  }

  const args = [
    "-p",
    promptArg.arg,
    "--output-format",
    "stream-json",
    ...parsed.extraArgs,
  ];

  // Build the subprocess environment: inherit, but strip the OIDC token
  // request variables so the agent cannot mint new GitHub OIDC tokens
  // (only the action itself needs them).
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  scrubInheritedPromptEnv(env, promptArg.writeOversized);
  env.KIMI_CODE_HOME = kimiHome;
  env.KIMI_DISABLE_TELEMETRY = "1";

  if (!parsed.showFullOutput) {
    console.log("Running kimi (full output hidden for security)...");
    console.log(
      "Rerun in debug mode or enable `show_full_output: true` in your workflow file for full output.",
    );
  }
  console.log(`Running kimi with prompt from file: ${promptPath}`);
  console.log(`Isolated KIMI_CODE_HOME: ${kimiHome}`);

  const rawLines: string[] = [];
  let sessionId: string | undefined;
  let hasAssistantContent = false;

  const handleLine = (line: string): void => {
    if (!line.trim()) return;
    rawLines.push(line);

    let msg: KimiStreamMessage;
    try {
      msg = JSON.parse(line) as KimiStreamMessage;
    } catch {
      core.warning(
        `Skipping non-JSON line from kimi output: ${line.slice(0, 200)}`,
      );
      return;
    }

    logStreamMessage(msg, parsed.showFullOutput);

    if (
      msg.role === "meta" &&
      msg.type === "session.resume_hint" &&
      typeof msg.session_id === "string" &&
      msg.session_id
    ) {
      sessionId = msg.session_id;
    }
    if (
      msg.role === "assistant" &&
      typeof msg.content === "string" &&
      msg.content.trim()
    ) {
      hasAssistantContent = true;
    }
  };

  // stderr carries tool progress hints — capture it for diagnostics and only
  // stream it live in full-output mode.
  let stderr = "";
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, args, { env });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (parsed.showFullOutput) {
        process.stderr.write(chunk);
      }
    });
    const rl = createInterface({ input: child.stdout });
    rl.on("line", handleLine);
    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to start kimi executable '${executable}': ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });

  const result: KimiRunResult = { conclusion: "failure" };

  const executionFile = await writeExecutionFile(rawLines);
  if (executionFile) {
    result.executionFile = executionFile;
  }

  if (sessionId) {
    result.sessionId = sessionId;
    core.info(`Set session_id: ${sessionId}`);
  } else {
    core.warning(
      "No session metadata found in kimi output; the session_id output will not be set",
    );
  }

  if (exitCode !== 0) {
    core.error(`kimi exited with code ${exitCode}`);
    if (stderr.trim()) {
      core.error(`kimi stderr (tail):\n${stderr.slice(-4000)}`);
    }
    throw new Error(`kimi execution failed with exit code ${exitCode}`);
  }

  // A denied tool call still exits 0 — the agent works around denials and
  // reports back — so success only requires a real assistant response.
  if (!hasAssistantContent) {
    core.error("kimi produced no assistant response");
    throw new Error("kimi execution failed: no assistant response in output");
  }

  result.conclusion = "success";
  return result;
}
