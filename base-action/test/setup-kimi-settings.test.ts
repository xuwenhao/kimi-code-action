#!/usr/bin/env bun

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadKimiSettingsFragment } from "../src/setup-kimi-settings";

describe("loadKimiSettingsFragment", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  test("returns empty string for empty input", async () => {
    expect(await loadKimiSettingsFragment(undefined)).toBe("");
    expect(await loadKimiSettingsFragment("")).toBe("");
    expect(await loadKimiSettingsFragment("   ")).toBe("");
  });

  test("returns inline TOML text as-is", async () => {
    const toml = "[loop_control]\nmax_steps_per_turn = 3";
    expect(await loadKimiSettingsFragment(toml)).toBe(toml);
  });

  test("reads the fragment from a .toml file path", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kimi-settings-"));
    const settingsPath = join(tempDir, "settings.toml");
    await writeFile(settingsPath, '[ui]\ntheme = "dark"\n');

    expect(await loadKimiSettingsFragment(settingsPath)).toBe(
      '[ui]\ntheme = "dark"\n',
    );
  });
});
