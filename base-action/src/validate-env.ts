const VALID_PLATFORMS = new Set(["code", "open-cn", "open-intl"]);

// Hosts of the Kimi Open Platform (CN and international). Their keys are NOT
// interchangeable with Kimi Code Console keys (mismatch = 401).
const OPEN_PLATFORM_HOST_MARKERS = ["api.moonshot.cn", "api.moonshot.ai"];

// Models that only exist on the Kimi Code endpoint (subscription).
const CODE_ONLY_MODELS = new Set([
  "kimi-for-coding",
  "kimi-for-coding-highspeed",
  "k3",
]);

/**
 * Validates the environment variables required for running the kimi CLI.
 */
export function validateEnvironmentVariables() {
  const errors: string[] = [];

  if (!process.env.KIMI_API_KEY && !process.env.KIMI_MODEL_API_KEY) {
    errors.push(
      "KIMI_API_KEY or KIMI_MODEL_API_KEY is required. Provide the `kimi_api_key` input (or set KIMI_MODEL_API_KEY in the environment).",
    );
  }

  const platform = process.env.KIMI_PLATFORM;
  if (platform && !VALID_PLATFORMS.has(platform)) {
    errors.push(
      `Invalid kimi_platform '${platform}'. Expected one of: code, open-cn, open-intl.`,
    );
  }

  // Fail fast on the classic misconfiguration: an Open Platform endpoint
  // paired with a Kimi Code-only model — this always 401s.
  const baseUrl = process.env.KIMI_MODEL_BASE_URL || "";
  const model = process.env.KIMI_MODEL_NAME || "";
  const isOpenPlatform = OPEN_PLATFORM_HOST_MARKERS.some((marker) =>
    baseUrl.includes(marker),
  );
  if (isOpenPlatform && CODE_ONLY_MODELS.has(model)) {
    errors.push(
      `Model '${model}' is only available on the Kimi Code endpoint (api.kimi.com/coding), not on the Open Platform (${baseUrl}). Open Platform keys require an Open Platform model id — set the kimi_model input accordingly (see docs/setup.md#model-and-endpoint-selection).`,
    );
  }

  if (errors.length > 0) {
    const errorMessage = `Environment variable validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`;
    throw new Error(errorMessage);
  }
}
