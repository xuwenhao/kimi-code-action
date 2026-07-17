#!/usr/bin/env bun

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { parseKimiOptions } from "../src/parse-kimi-options";

describe("parseKimiOptions", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  describe("permission rules", () => {
    test("maps --allowedTools to allow rules, deny rules come first", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: '--disallowedTools "Bash,Write" --allowedTools "Edit,Read"',
      });

      expect(parsed.permissionRules).toEqual([
        { decision: "deny", pattern: "Bash" },
        { decision: "deny", pattern: "Write" },
        { decision: "allow", pattern: "Edit" },
        { decision: "allow", pattern: "Read" },
      ]);
    });

    test("translates Claude tool names to kimi names", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs:
          '--allowedTools "WebFetch,TodoWrite,LS,Grep,Glob,WebSearch,mcp__github_ci__get_ci_status"',
      });

      expect(parsed.permissionRules).toEqual([
        { decision: "allow", pattern: "FetchURL" },
        { decision: "allow", pattern: "TodoList" },
        { decision: "allow", pattern: "Glob" },
        { decision: "allow", pattern: "Grep" },
        { decision: "allow", pattern: "WebSearch" },
        {
          decision: "allow",
          pattern: "mcp__github_ci__get_ci_status",
        },
      ]);
    });

    test("drops NotebookEdit with a warning", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: '--allowedTools "NotebookEdit,Read"',
      });

      expect(parsed.permissionRules).toEqual([
        { decision: "allow", pattern: "Read" },
      ]);
    });

    test("passes unknown tools through unchanged", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: '--allowedTools "SomeFutureTool,Read"',
      });

      expect(parsed.permissionRules).toEqual([
        { decision: "allow", pattern: "SomeFutureTool" },
        { decision: "allow", pattern: "Read" },
      ]);
    });

    test("normalizes Claude colon-glob Bash scopes to kimi prefix patterns", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: '--disallowedTools "Bash(rm:*),Bash(sudo:*)"',
      });

      expect(parsed.permissionRules).toEqual([
        { decision: "deny", pattern: "Bash(rm*)" },
        { decision: "deny", pattern: "Bash(sudo*)" },
      ]);
    });

    test("keeps unquoted Bash(gh:*) intact (shell metachar escaping)", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: "--allowedTools View,Bash(gh:*),Bash(cat:*)",
      });

      expect(parsed.permissionRules).toEqual([
        { decision: "allow", pattern: "View" },
        { decision: "allow", pattern: "Bash(gh*)" },
        { decision: "allow", pattern: "Bash(cat*)" },
      ]);
    });

    test("handles multiple space-separated tool values", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: "--allowed-tools Bash(gh:*) Bash(cat:*) Read(//tmp/**)",
      });

      expect(parsed.permissionRules).toEqual([
        { decision: "allow", pattern: "Bash(gh*)" },
        { decision: "allow", pattern: "Bash(cat*)" },
        { decision: "allow", pattern: "Read(//tmp/**)" },
      ]);
    });

    test("merges tools from repeated flags, both variants, and the direct option", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs:
          '--allowedTools "Edit,Read" --allowed-tools "Write,Glob" --allowedTools "Bash"',
        allowedTools: "WebSearch",
      });

      // --allowedTools values come first, then --allowed-tools, then the direct option
      expect(parsed.permissionRules).toEqual([
        { decision: "allow", pattern: "Edit" },
        { decision: "allow", pattern: "Read" },
        { decision: "allow", pattern: "Bash" },
        { decision: "allow", pattern: "Write" },
        { decision: "allow", pattern: "Glob" },
        { decision: "allow", pattern: "WebSearch" },
      ]);
    });

    test("dedupes repeated tool entries", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: '--allowedTools "Edit,Read"',
        allowedTools: "Edit",
      });

      expect(parsed.permissionRules).toEqual([
        { decision: "allow", pattern: "Edit" },
        { decision: "allow", pattern: "Read" },
      ]);
    });
  });

  describe("max-turns", () => {
    test("maps --max-turns to maxSteps", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: "--max-turns 10",
      });

      expect(parsed.maxSteps).toBe(10);
      expect(parsed.extraArgs).toEqual([]);
    });

    test("direct maxTurns option wins over --max-turns", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: "--max-turns 10",
        maxTurns: "3",
      });

      expect(parsed.maxSteps).toBe(3);
    });

    test("rejects a non-numeric --max-turns", async () => {
      await expect(
        parseKimiOptions({ kimiArgs: "--max-turns abc" }),
      ).rejects.toThrow("--max-turns must be a positive integer");
    });
  });

  describe("mcp-config", () => {
    test("merges multiple inline JSON configs", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: `--mcp-config '{"mcpServers":{"server1":{"command":"cmd1"}}}' --mcp-config '{"mcpServers":{"server2":{"command":"cmd2"}}}'`,
      });

      expect(parsed.mcpServers).toEqual({
        server1: { command: "cmd1" },
        server2: { command: "cmd2" },
      });
      expect(parsed.extraArgs).toEqual([]);
    });

    test("reads and merges a config from a file path", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "kimi-parse-"));
      const configPath = join(tempDir, "mcp.json");
      await writeFile(
        configPath,
        JSON.stringify({ mcpServers: { file_server: { command: "fs" } } }),
      );

      const parsed = await parseKimiOptions({
        kimiArgs: `--mcp-config '{"mcpServers":{"inline_server":{"command":"in"}}}' --mcp-config ${configPath}`,
      });

      expect(parsed.mcpServers).toEqual({
        inline_server: { command: "in" },
        file_server: { command: "fs" },
      });
    });

    test("merges the direct mcpConfig option before kimiArgs values", async () => {
      const parsed = await parseKimiOptions({
        mcpConfig: '{"mcpServers":{"base":{"command":"a","env":{"X":"1"}}}}',
        kimiArgs: `--mcp-config '{"mcpServers":{"base":{"command":"b"}}}'`,
      });

      // kimiArgs wins on conflicting server names
      expect(parsed.mcpServers).toEqual({
        base: { command: "b" },
      });
    });

    test("throws on an unreadable mcp-config file", async () => {
      await expect(
        parseKimiOptions({ kimiArgs: "--mcp-config /nonexistent/mcp.json" }),
      ).rejects.toThrow("Failed to read --mcp-config file");
    });

    test("throws on invalid inline JSON", async () => {
      await expect(
        parseKimiOptions({ kimiArgs: "--mcp-config '{broken'" }),
      ).rejects.toThrow("Failed to parse --mcp-config value as JSON");
    });
  });

  describe("model", () => {
    test("maps --model to extraArgs", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: "--model kimi-k2",
      });

      expect(parsed.extraArgs).toEqual(["--model", "kimi-k2"]);
    });

    test("maps -m to extraArgs", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: "-m kimi-k2",
      });

      expect(parsed.extraArgs).toEqual(["--model", "kimi-k2"]);
    });

    test("direct model option wins over --model", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: "--model kimi-k2",
        model: "kimi-for-coding",
      });

      expect(parsed.extraArgs).toEqual(["--model", "kimi-for-coding"]);
    });
  });

  describe("permission-mode", () => {
    test.each(["acceptEdits", "plan", "bypassPermissions", "default"])(
      "%s is rejected (kimi -p always runs with auto permissions)",
      async (mode) => {
        await expect(
          parseKimiOptions({ kimiArgs: `--permission-mode ${mode}` }),
        ).rejects.toThrow(`--permission-mode ${mode} is not applicable`);
      },
    );
  });

  describe("unsupported flags", () => {
    test("--json-schema throws with a kimi alternative", async () => {
      await expect(
        parseKimiOptions({ kimiArgs: `--json-schema '{"type":"object"}'` }),
      ).rejects.toThrow(
        /--json-schema is not supported.*final assistant message/,
      );
    });

    test("--system-prompt throws with a kimi alternative", async () => {
      await expect(
        parseKimiOptions({ kimiArgs: "--system-prompt 'you are helpful'" }),
      ).rejects.toThrow(
        /--system-prompt is not supported.*--append-system-prompt/,
      );
    });
  });

  describe("append-system-prompt", () => {
    test("extracts the flag value", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: '--append-system-prompt "extra instructions"',
      });

      expect(parsed.appendSystemPrompt).toBe("extra instructions");
      expect(parsed.extraArgs).toEqual([]);
    });

    test("direct option wins over the flag", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: '--append-system-prompt "from args"',
        appendSystemPrompt: "from option",
      });

      expect(parsed.appendSystemPrompt).toBe("from option");
    });
  });

  describe("extra args pass-through", () => {
    test("passes unknown flags through as argv", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: '--verbose --some-flag "some value"',
      });

      expect(parsed.extraArgs).toEqual([
        "--verbose",
        "--some-flag",
        "some value",
      ]);
    });

    test("repeats accumulating flags for each value", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: '--add-dir "/path/to/dir-a"\n--add-dir "/path/to/dir-b"',
      });

      expect(parsed.extraArgs).toEqual([
        "--add-dir",
        "/path/to/dir-a",
        "--add-dir",
        "/path/to/dir-b",
      ]);
    });

    test("strips comment lines but keeps inline # in values", async () => {
      const parsed = await parseKimiOptions({
        kimiArgs: "--model 'kimi-k2'\n# comment\n--prompt 'use color #ff0000'",
      });

      // --model is extracted and re-appended after the pass-through flags
      expect(parsed.extraArgs).toEqual([
        "--prompt",
        "use color #ff0000",
        "--model",
        "kimi-k2",
      ]);
    });
  });

  describe("showFullOutput", () => {
    const originalDebug = process.env.ACTIONS_STEP_DEBUG;

    afterEach(() => {
      if (originalDebug === undefined) {
        delete process.env.ACTIONS_STEP_DEBUG;
      } else {
        process.env.ACTIONS_STEP_DEBUG = originalDebug;
      }
    });

    test("is false by default", async () => {
      delete process.env.ACTIONS_STEP_DEBUG;
      const parsed = await parseKimiOptions({});
      expect(parsed.showFullOutput).toBe(false);
    });

    test('is true when the option is "true"', async () => {
      delete process.env.ACTIONS_STEP_DEBUG;
      const parsed = await parseKimiOptions({ showFullOutput: "true" });
      expect(parsed.showFullOutput).toBe(true);
    });

    test("is true in Actions step debug mode", async () => {
      process.env.ACTIONS_STEP_DEBUG = "true";
      const parsed = await parseKimiOptions({});
      expect(parsed.showFullOutput).toBe(true);
    });
  });
});
