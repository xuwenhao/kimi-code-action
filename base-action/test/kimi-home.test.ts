#!/usr/bin/env bun

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_DENY_RULES, writeKimiHome } from "../src/kimi-home";

describe("writeKimiHome", () => {
  const originalRunnerTemp = process.env.RUNNER_TEMP;
  let tempDir: string | undefined;
  let createdHomes: string[] = [];

  async function makeHome(
    config: Parameters<typeof writeKimiHome>[0],
  ): Promise<string> {
    const home = await writeKimiHome(config);
    createdHomes.push(home);
    return home;
  }

  afterEach(async () => {
    for (const home of createdHomes) {
      await rm(home, { recursive: true, force: true });
    }
    createdHomes = [];
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    if (originalRunnerTemp === undefined) {
      delete process.env.RUNNER_TEMP;
    } else {
      process.env.RUNNER_TEMP = originalRunnerTemp;
    }
  });

  test("creates the home under RUNNER_TEMP and returns its path", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kimi-home-test-"));
    process.env.RUNNER_TEMP = tempDir;

    const home = await makeHome({ permissionRules: [], mcpServers: {} });

    expect(home.startsWith(tempDir)).toBe(true);
    expect(existsSync(join(home, "config.toml"))).toBe(true);
  });

  test("config.toml starts with the default deny rules in order", async () => {
    const home = await makeHome({
      permissionRules: [{ decision: "allow", pattern: "Read" }],
      mcpServers: {},
    });
    const toml = await readFile(join(home, "config.toml"), "utf-8");

    const defaultPositions = DEFAULT_DENY_RULES.map((rule) =>
      toml.indexOf(`pattern = "${rule.pattern}"`),
    );
    // All default rules present, in declared order
    for (const pos of defaultPositions) {
      expect(pos).toBeGreaterThanOrEqual(0);
    }
    expect(defaultPositions).toEqual(
      [...defaultPositions].sort((a, b) => a - b),
    );
    // Default denies come before user rules so first-match-wins protects them
    const userRulePos = toml.indexOf('pattern = "Read"');
    expect(userRulePos).toBeGreaterThan(defaultPositions.at(-1)!);

    // Default rules deny writes to workflows and force pushes
    expect(toml).toContain('pattern = "Write(.github/workflows/**)"');
    expect(toml).toContain('pattern = "Edit(.github/workflows/**)"');
    expect(toml).toContain('pattern = "Bash(git push --force*)"');
    expect(toml).toContain('pattern = "Bash(git push*-f*)"');
  });

  test("writes user deny rules before user allow rules", async () => {
    const home = await makeHome({
      permissionRules: [
        { decision: "deny", pattern: "Bash(rm*)" },
        { decision: "allow", pattern: "Read" },
      ],
      mcpServers: {},
    });
    const toml = await readFile(join(home, "config.toml"), "utf-8");

    expect(toml.indexOf('pattern = "Bash(rm*)"')).toBeLessThan(
      toml.indexOf('pattern = "Read"'),
    );
  });

  test("includes reasons on rules that have them", async () => {
    const home = await makeHome({
      permissionRules: [
        { decision: "deny", pattern: "Bash(sudo*)", reason: "no sudo" },
      ],
      mcpServers: {},
    });
    const toml = await readFile(join(home, "config.toml"), "utf-8");

    expect(toml).toContain('reason = "no sudo"');
    // Default deny rules carry their own reasons
    expect(toml).toContain('reason = "Force-pushing is not allowed"');
  });

  test("writes loop control when maxSteps is set", async () => {
    const home = await makeHome({
      permissionRules: [],
      mcpServers: {},
      maxSteps: 7,
    });
    const toml = await readFile(join(home, "config.toml"), "utf-8");

    expect(toml).toContain("[loop_control]");
    expect(toml).toContain("max_steps_per_turn = 7");
  });

  test("omits loop control when maxSteps is not set", async () => {
    const home = await makeHome({ permissionRules: [], mcpServers: {} });
    const toml = await readFile(join(home, "config.toml"), "utf-8");

    expect(toml).not.toContain("[loop_control]");
  });

  test("appends the settings fragment verbatim", async () => {
    const home = await makeHome({
      permissionRules: [],
      mcpServers: {},
      settingsFragment: '[ui]\ntheme = "dark"\n',
    });
    const toml = await readFile(join(home, "config.toml"), "utf-8");

    expect(toml).toContain('[ui]\ntheme = "dark"');
  });

  test("writes mcp.json only when servers are configured", async () => {
    const withServers = await makeHome({
      permissionRules: [],
      mcpServers: { github_comment: { command: "bun", args: ["server.ts"] } },
    });
    const mcpJson = JSON.parse(
      await readFile(join(withServers, "mcp.json"), "utf-8"),
    );
    expect(mcpJson).toEqual({
      mcpServers: { github_comment: { command: "bun", args: ["server.ts"] } },
    });

    const withoutServers = await makeHome({
      permissionRules: [],
      mcpServers: {},
    });
    expect(existsSync(join(withoutServers, "mcp.json"))).toBe(false);
  });
});
