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
    delete process.env.KIMI_PLATFORM;
    delete process.env.KIMI_MODEL_BASE_URL;
    delete process.env.KIMI_MODEL_NAME;
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

  describe("kimi_platform validation", () => {
    beforeEach(() => {
      process.env.KIMI_API_KEY = "test-api-key";
    });

    test("should pass for each valid platform preset", () => {
      for (const platform of ["code", "open-cn", "open-intl"]) {
        process.env.KIMI_PLATFORM = platform;
        expect(() => validateEnvironmentVariables()).not.toThrow();
      }
    });

    test("should pass when KIMI_PLATFORM is unset (backward compatible)", () => {
      expect(() => validateEnvironmentVariables()).not.toThrow();
    });

    test("should fail for an unknown platform value", () => {
      process.env.KIMI_PLATFORM = "open-eu";

      expect(() => validateEnvironmentVariables()).toThrow(
        "Invalid kimi_platform 'open-eu'. Expected one of: code, open-cn, open-intl.",
      );
    });
  });

  describe("model/endpoint mismatch validation", () => {
    beforeEach(() => {
      process.env.KIMI_API_KEY = "test-api-key";
    });

    test("should fail for open-cn endpoint with the Kimi Code-only default model", () => {
      process.env.KIMI_MODEL_BASE_URL = "https://api.moonshot.cn/v1";
      process.env.KIMI_MODEL_NAME = "kimi-for-coding";

      expect(() => validateEnvironmentVariables()).toThrow(
        "Model 'kimi-for-coding' is only available on the Kimi Code endpoint",
      );
    });

    test("should fail for open-intl endpoint with the Kimi Code-only default model", () => {
      process.env.KIMI_MODEL_BASE_URL = "https://api.moonshot.ai/v1";
      process.env.KIMI_MODEL_NAME = "kimi-for-coding";

      expect(() => validateEnvironmentVariables()).toThrow(
        "set the kimi_model input accordingly",
      );
    });

    test("should pass for open-cn endpoint with an Open Platform model id", () => {
      process.env.KIMI_MODEL_BASE_URL = "https://api.moonshot.cn/v1";
      process.env.KIMI_MODEL_NAME = "kimi-k2-0905-preview";

      expect(() => validateEnvironmentVariables()).not.toThrow();
    });

    test("should pass for the Kimi Code endpoint with the default model", () => {
      process.env.KIMI_MODEL_BASE_URL = "https://api.kimi.com/coding/v1";
      process.env.KIMI_MODEL_NAME = "kimi-for-coding";

      expect(() => validateEnvironmentVariables()).not.toThrow();
    });

    test("should pass when no base URL/model is set (CLI defaults)", () => {
      expect(() => validateEnvironmentVariables()).not.toThrow();
    });
  });
});
