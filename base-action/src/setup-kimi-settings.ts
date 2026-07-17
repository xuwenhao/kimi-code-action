import { existsSync } from "fs";
import { readFile } from "fs/promises";

/**
 * Resolve the `settings` input into a TOML fragment for config.toml.
 * kimi has no settings.json — its configuration surface is config.toml, so
 * the input is accepted verbatim (no parsing) and appended to the generated
 * config.toml by writeKimiHome. The input is either inline TOML text or a
 * path to a .toml file (read when it exists). Empty input returns "".
 */
export async function loadKimiSettingsFragment(
  input?: string,
): Promise<string> {
  if (!input?.trim()) {
    return "";
  }

  if (existsSync(input)) {
    console.log(`Loading kimi settings from file: ${input}`);
    return await readFile(input, "utf-8");
  }

  console.log("Using inline kimi settings fragment");
  return input;
}
