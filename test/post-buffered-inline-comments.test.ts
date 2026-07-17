#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { classifyComments } from "../src/entrypoints/post-buffered-inline-comments";

describe("classifyComments", () => {
  let originalApiKey: string | undefined;
  let originalBaseUrl: string | undefined;
  let originalModelName: string | undefined;
  let fetchSpy: any;
  let consoleLogSpy: any;

  beforeEach(() => {
    originalApiKey = process.env.KIMI_API_KEY;
    originalBaseUrl = process.env.KIMI_BASE_URL;
    originalModelName = process.env.KIMI_MODEL_NAME;
    delete process.env.KIMI_API_KEY;
    delete process.env.KIMI_BASE_URL;
    delete process.env.KIMI_MODEL_NAME;

    fetchSpy = spyOn(global, "fetch");
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.KIMI_API_KEY;
    else process.env.KIMI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.KIMI_BASE_URL;
    else process.env.KIMI_BASE_URL = originalBaseUrl;
    if (originalModelName === undefined) delete process.env.KIMI_MODEL_NAME;
    else process.env.KIMI_MODEL_NAME = originalModelName;

    fetchSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  function mockChatCompletion(content: string, status = 200): void {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status,
      }),
    );
  }

  test("returns null without calling the API when KIMI_API_KEY is unset", async () => {
    const result = await classifyComments(["body"]);

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("calls the Kimi Code chat completions endpoint by default", async () => {
    process.env.KIMI_API_KEY = "test-key";
    mockChatCompletion("[true, false]");

    const result = await classifyComments(["real review", "test probe"]);

    expect(result).toEqual([true, false]);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.kimi.com/coding/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer test-key",
    );

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("kimi-for-coding");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain("real review");
    expect(body.messages[0].content).toContain("test probe");
  });

  test("honors KIMI_BASE_URL and KIMI_MODEL_NAME", async () => {
    process.env.KIMI_API_KEY = "test-key";
    process.env.KIMI_BASE_URL = "https://kimi.internal.example/v1";
    process.env.KIMI_MODEL_NAME = "kimi-k2";
    mockChatCompletion("[true]");

    const result = await classifyComments(["body"]);

    expect(result).toEqual([true]);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://kimi.internal.example/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("kimi-k2");
  });

  test("extracts the JSON array from surrounding prose", async () => {
    process.env.KIMI_API_KEY = "test-key";
    mockChatCompletion("Here is the verdict:\n[false, true]\nDone.");

    const result = await classifyComments(["a", "b"]);

    expect(result).toEqual([false, true]);
  });

  test("returns null on a non-OK response (fail-open)", async () => {
    process.env.KIMI_API_KEY = "test-key";
    mockChatCompletion("irrelevant", 500);

    const result = await classifyComments(["body"]);

    expect(result).toBeNull();
  });

  test("returns null when the response has no JSON array (fail-open)", async () => {
    process.env.KIMI_API_KEY = "test-key";
    mockChatCompletion("I cannot classify these.");

    const result = await classifyComments(["body"]);

    expect(result).toBeNull();
  });

  test("returns null on array length mismatch (fail-open)", async () => {
    process.env.KIMI_API_KEY = "test-key";
    mockChatCompletion("[true]");

    const result = await classifyComments(["a", "b"]);

    expect(result).toBeNull();
  });

  test("returns null on non-boolean array entries (fail-open)", async () => {
    process.env.KIMI_API_KEY = "test-key";
    mockChatCompletion('["yes", "no"]');

    const result = await classifyComments(["a", "b"]);

    expect(result).toBeNull();
  });

  test("returns null when fetch throws (fail-open)", async () => {
    process.env.KIMI_API_KEY = "test-key";
    fetchSpy.mockRejectedValue(new Error("network down"));

    const result = await classifyComments(["body"]);

    expect(result).toBeNull();
  });
});
