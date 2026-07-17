// @ts-check
// E2E smoke script: verifies the repo's action.yml parses and has required keys.
import { readFileSync } from "node:fs";

const raw = readFileSync("action.yml", "utf-8");

// Intentionally naive parsing (e2e fodder): just checks substrings.
const required = ["name:", "kimi_api_key", "runs:", "composite"];
const missing = required.filter((k) => !raw.includes(k));

if (missing.length > 0) {
  console.error("action.yml missing keys:", missing);
  process.exit(1);
}

const unused = "this variable is never used";
console.log("action.yml looks fine");
