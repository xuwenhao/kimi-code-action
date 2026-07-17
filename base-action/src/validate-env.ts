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

  if (errors.length > 0) {
    const errorMessage = `Environment variable validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`;
    throw new Error(errorMessage);
  }
}
