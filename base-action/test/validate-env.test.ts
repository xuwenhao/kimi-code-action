#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { validateEnvironmentVariables } from "../src/validate-env";

describe("validateEnvironmentVariables", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save the original environment
    originalEnv = { ...process.env };
    // Clear relevant environment variables
    delete process.env.KIMI_API_KEY;
    delete process.env.KIMI_MODEL_API_KEY;
  });

  afterEach(() => {
    // Restore the original environment
    process.env = originalEnv;
  });

  test("should pass when KIMI_API_KEY is provided", () => {
    process.env.KIMI_API_KEY = "test-api-key";

    expect(() => validateEnvironmentVariables()).not.toThrow();
  });

  test("should pass when KIMI_MODEL_API_KEY is provided", () => {
    process.env.KIMI_MODEL_API_KEY = "test-api-key";

    expect(() => validateEnvironmentVariables()).not.toThrow();
  });

  test("should fail when neither key is provided", () => {
    expect(() => validateEnvironmentVariables()).toThrow(
      "KIMI_API_KEY or KIMI_MODEL_API_KEY is required.",
    );
  });

  test("should format the error message properly", () => {
    let error: Error | undefined;
    try {
      validateEnvironmentVariables();
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error!.message).toMatch(/^Environment variable validation failed:/);
    expect(error!.message).toContain("kimi_api_key");
  });
});
