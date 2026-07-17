import { describe, test, expect } from "bun:test";
import { extractUserRequest } from "../src/utils/extract-user-request";

describe("extractUserRequest", () => {
  test("extracts text after @kimi trigger", () => {
    expect(extractUserRequest("@kimi /review-pr", "@kimi")).toBe("/review-pr");
  });

  test("extracts slash command with arguments", () => {
    expect(
      extractUserRequest(
        "@kimi /review-pr please check the auth module",
        "@kimi",
      ),
    ).toBe("/review-pr please check the auth module");
  });

  test("handles trigger phrase with extra whitespace", () => {
    expect(extractUserRequest("@kimi    /review-pr", "@kimi")).toBe(
      "/review-pr",
    );
  });

  test("handles trigger phrase at start of multiline comment", () => {
    const comment = `@kimi /review-pr
Please review this PR carefully.
Focus on security issues.`;
    expect(extractUserRequest(comment, "@kimi")).toBe(
      `/review-pr
Please review this PR carefully.
Focus on security issues.`,
    );
  });

  test("handles trigger phrase in middle of text", () => {
    expect(
      extractUserRequest("Hey team, @kimi can you review this?", "@kimi"),
    ).toBe("can you review this?");
  });

  test("returns null for empty comment body", () => {
    expect(extractUserRequest("", "@kimi")).toBeNull();
  });

  test("returns null for undefined comment body", () => {
    expect(extractUserRequest(undefined, "@kimi")).toBeNull();
  });

  test("returns null when trigger phrase not found", () => {
    expect(extractUserRequest("Please review this PR", "@kimi")).toBeNull();
  });

  test("returns null when only trigger phrase with no request", () => {
    expect(extractUserRequest("@kimi", "@kimi")).toBeNull();
  });

  test("handles custom trigger phrase", () => {
    expect(extractUserRequest("/kimi help me", "/kimi")).toBe("help me");
  });

  test("handles trigger phrase with special regex characters", () => {
    expect(extractUserRequest("@kimi[bot] do something", "@kimi[bot]")).toBe(
      "do something",
    );
  });

  test("is case insensitive", () => {
    expect(extractUserRequest("@KIMI /review-pr", "@kimi")).toBe("/review-pr");
    expect(extractUserRequest("@Kimi /review-pr", "@kimi")).toBe("/review-pr");
  });
});
