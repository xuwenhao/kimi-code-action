#!/usr/bin/env bun
/**
 * Reads buffered inline-comment calls from /tmp/inline-comments-buffer.jsonl,
 * classifies each as "real review" vs "test/probe" using the kimi API, and
 * posts only the real ones. Calls with confirmed=false are never posted.
 *
 * If the kimi API is unavailable (no API key, HTTP error, or an unparseable
 * response), falls back to posting everything with confirmed !== false —
 * the classifier may pass, but never silently drops review feedback.
 */
import { readFileSync } from "fs";
import { createOctokit } from "../github/api/client";

const BUFFER_PATH = "/tmp/inline-comments-buffer.jsonl";

type BufferedComment = {
  ts: string;
  path: string;
  line?: number;
  startLine?: number;
  side?: "LEFT" | "RIGHT";
  commit_id?: string;
  body: string;
  confirmed?: boolean;
};

const CLASSIFICATION_PROMPT = `You are classifying PR inline comments as either REAL code review feedback or TEST/PROBE calls.

A TEST/PROBE call is when an automated agent is checking whether a commenting tool works. These typically:
- Start with phrases like "Test comment", "Testing if", "Can I", "Does this work", "Checking if"
- Have generic/placeholder content not specific to any code
- Exist to verify tool functionality, not to provide review feedback

A REAL review comment:
- Discusses specific code, logic, bugs, or style
- Provides actionable feedback for the PR author
- References concrete aspects of the change

For each numbered comment body below, respond with ONLY a JSON array of booleans where true = REAL review comment, false = test/probe. No other text.

Comments:
`;

/** OpenAI-compatible chat completions response shape (subset we read). */
type ChatCompletionsResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function classifyComments(
  bodies: string[],
): Promise<boolean[] | null> {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    console.log(
      "KIMI_API_KEY not set — skipping classification, posting all unconfirmed comments",
    );
    return null;
  }

  const baseUrl = process.env.KIMI_BASE_URL || "https://api.kimi.com/coding/v1";
  const model = process.env.KIMI_MODEL_NAME || "k3";

  const prompt =
    CLASSIFICATION_PROMPT +
    bodies.map((b, i) => `${i + 1}. ${JSON.stringify(b)}`).join("\n");

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.log(
        `Classification API returned ${res.status} — posting all unconfirmed comments`,
      );
      return null;
    }

    const data = (await res.json()) as ChatCompletionsResponse;
    const text = data.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      console.log(
        "Could not parse classification response — posting all unconfirmed comments",
      );
      return null;
    }
    const parsed = JSON.parse(match[0]);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== bodies.length ||
      !parsed.every((v) => typeof v === "boolean")
    ) {
      console.log(
        "Classification response shape mismatch — posting all unconfirmed comments",
      );
      return null;
    }
    return parsed;
  } catch (e) {
    console.log(
      `Classification failed (${e instanceof Error ? e.message : String(e)}) — posting all unconfirmed comments`,
    );
    return null;
  }
}

async function postComment(
  octokit: ReturnType<typeof createOctokit>["rest"],
  owner: string,
  repo: string,
  pull_number: number,
  headSha: string,
  c: BufferedComment,
): Promise<boolean> {
  const params: Parameters<typeof octokit.rest.pulls.createReviewComment>[0] = {
    owner,
    repo,
    pull_number,
    body: c.body,
    path: c.path,
    side: c.side || "RIGHT",
    commit_id: c.commit_id || headSha,
  };
  if (c.startLine) {
    params.start_line = c.startLine;
    params.start_side = c.side || "RIGHT";
    params.line = c.line;
  } else {
    params.line = c.line;
  }
  try {
    await octokit.rest.pulls.createReviewComment(params);
    return true;
  } catch (e) {
    console.log(
      `  failed ${c.path}:${c.line}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

async function main() {
  let raw: string;
  try {
    raw = readFileSync(BUFFER_PATH, "utf8");
  } catch {
    console.log("No buffered inline comments");
    return;
  }

  const comments: BufferedComment[] = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  if (comments.length === 0) {
    console.log("No buffered inline comments");
    return;
  }

  console.log(`Found ${comments.length} buffered inline comment(s)`);

  const githubToken = process.env.GITHUB_TOKEN;
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;
  const prNumber = process.env.PR_NUMBER;

  if (!githubToken || !owner || !repo || !prNumber) {
    console.log(
      "::warning::Missing GITHUB_TOKEN/REPO_OWNER/REPO_NAME/PR_NUMBER — cannot post buffered comments",
    );
    return;
  }

  // Partition: confirmed=false are never posted; the rest are candidates
  const neverPost = comments.filter((c) => c.confirmed === false);
  const candidates = comments.filter((c) => c.confirmed !== false);

  if (neverPost.length > 0) {
    console.log(`  ${neverPost.length} with confirmed=false — not posting`);
  }

  if (candidates.length === 0) {
    return;
  }

  // Classify candidates
  const verdicts = await classifyComments(candidates.map((c) => c.body));
  const toPost =
    verdicts === null
      ? candidates
      : candidates.filter((_, i) => verdicts[i] === true);
  const filtered =
    verdicts === null ? [] : candidates.filter((_, i) => verdicts[i] === false);

  if (filtered.length > 0) {
    console.log(
      `::warning::${filtered.length} buffered comment(s) classified as test/probe — NOT posted:`,
    );
    for (const c of filtered) {
      console.log(`  [${c.path}:${c.line}] ${c.body.slice(0, 120)}`);
    }
  }

  if (toPost.length === 0) {
    console.log("No real comments to post");
    return;
  }

  const octokit = createOctokit(githubToken).rest;
  const pull_number = parseInt(prNumber, 10);
  const pr = await octokit.pulls.get({ owner, repo, pull_number });
  const headSha = pr.data.head.sha;

  console.log(`Posting ${toPost.length} classified-as-real comment(s)`);
  let posted = 0;
  for (const c of toPost) {
    if (await postComment(octokit, owner, repo, pull_number, headSha, c)) {
      console.log(`  posted ${c.path}:${c.line}`);
      posted++;
    }
  }
  console.log(`Posted ${posted}/${toPost.length}`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error("post-buffered-inline-comments failed:", e);
    process.exit(1);
  });
}
