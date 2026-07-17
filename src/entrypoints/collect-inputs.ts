export function collectActionInputsPresence(): string {
  const inputDefaults: Record<string, string> = {
    trigger_phrase: "@kimi",
    assignee_trigger: "",
    label_trigger: "kimi",
    base_branch: "",
    branch_prefix: "kimi/",
    allowed_bots: "",
    mode: "tag",
    model: "",
    fallback_model: "",
    allowed_tools: "",
    disallowed_tools: "",
    custom_instructions: "",
    direct_prompt: "",
    override_prompt: "",
    settings: "",
    kimi_api_key: "",
    github_token: "",
    max_turns: "",
    use_sticky_comment: "false",
    classify_inline_comments: "true",
    use_commit_signing: "false",
    ssh_signing_key: "",
  };

  const allInputsJson = process.env.ALL_INPUTS;
  if (!allInputsJson) {
    console.log("ALL_INPUTS environment variable not found");
    return JSON.stringify({});
  }

  let allInputs: Record<string, string>;
  try {
    allInputs = JSON.parse(allInputsJson);
  } catch (e) {
    console.error("Failed to parse ALL_INPUTS JSON:", e);
    return JSON.stringify({});
  }

  const presentInputs: Record<string, boolean> = {};

  for (const [name, defaultValue] of Object.entries(inputDefaults)) {
    const actualValue = allInputs[name] || "";

    const isSet = actualValue !== defaultValue;
    presentInputs[name] = isSet;
  }

  return JSON.stringify(presentInputs);
}
