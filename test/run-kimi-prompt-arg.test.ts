import { describe, expect, test } from "bun:test";
import {
  MAX_INLINE_PROMPT_BYTES,
  promptArgForSize,
} from "../base-action/src/run-kimi";

describe("promptArgForSize", () => {
  test("small prompt passes inline", () => {
    const r = promptArgForSize(
      "do the thing",
      "/tmp/kimi-prompt-oversized.txt",
    );
    expect(r.writeOversized).toBe(false);
    expect(r.arg).toBe("do the thing");
  });

  test("oversized prompt falls back to a read-file instruction", () => {
    const big = "x".repeat(MAX_INLINE_PROMPT_BYTES + 1);
    const r = promptArgForSize(big, "/tmp/kimi-prompt-oversized.txt");
    expect(r.writeOversized).toBe(true);
    expect(r.arg).toContain("/tmp/kimi-prompt-oversized.txt");
    // the replacement arg itself must stay far below the 128 KiB argv cap
    expect(Buffer.byteLength(r.arg, "utf-8")).toBeLessThan(1024);
  });

  test("threshold is measured in bytes, not characters", () => {
    // 3-byte chars: floor(102400/3) chars stay under, one more crosses
    const under = "汉".repeat(Math.floor(MAX_INLINE_PROMPT_BYTES / 3));
    expect(promptArgForSize(under, "/tmp/x").writeOversized).toBe(false);
    expect(promptArgForSize(under + "汉", "/tmp/x").writeOversized).toBe(true);
  });
});
