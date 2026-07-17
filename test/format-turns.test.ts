import { expect, test, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseExecutionLog,
  formatTurnsFromData,
  groupTurnsNaturally,
  formatGroupedContent,
  detectContentType,
  formatResultContent,
  formatToolWithResult,
  type Turn,
  type ToolUse,
  type ToolResult,
} from "../src/entrypoints/format-turns";

describe("parseExecutionLog", () => {
  test("parses one stream-json message per line", () => {
    const content = [
      '{"role":"assistant","content":"hi"}',
      '{"role":"meta","type":"session.resume_hint","session_id":"s1"}',
    ].join("\n");

    const turns = parseExecutionLog(content);

    expect(turns).toHaveLength(2);
    expect(turns[0]!.role).toBe("assistant");
    expect(turns[1]!.session_id).toBe("s1");
  });

  test("skips empty lines and non-JSON lines", () => {
    const content = [
      '{"role":"assistant","content":"hi"}',
      "",
      "this is not json",
      "   ",
      '{"role":"tool","tool_call_id":"t1","content":"out"}',
    ].join("\n");

    const turns = parseExecutionLog(content);

    expect(turns).toHaveLength(2);
    expect(turns[1]!.role).toBe("tool");
  });
});

describe("detectContentType", () => {
  test("detects JSON objects", () => {
    expect(detectContentType('{"key": "value"}')).toBe("json");
    expect(detectContentType('{"number": 42}')).toBe("json");
  });

  test("detects JSON arrays", () => {
    expect(detectContentType("[1, 2, 3]")).toBe("json");
    expect(detectContentType('["a", "b"]')).toBe("json");
  });

  test("detects Python code", () => {
    expect(detectContentType("def hello():\n    pass")).toBe("python");
    expect(detectContentType("import os")).toBe("python");
    expect(detectContentType("from math import pi")).toBe("python");
  });

  test("detects JavaScript code", () => {
    expect(detectContentType("function test() {}")).toBe("javascript");
    expect(detectContentType("const x = 5")).toBe("javascript");
    expect(detectContentType("let y = 10")).toBe("javascript");
    expect(detectContentType("const fn = () => console.log()")).toBe(
      "javascript",
    );
  });

  test("detects bash/shell content", () => {
    expect(detectContentType("/usr/bin/test")).toBe("bash");
    expect(detectContentType("Error: command not found")).toBe("bash");
    expect(detectContentType("ls -la")).toBe("bash");
    expect(detectContentType("$ echo hello")).toBe("bash");
  });

  test("detects diff format", () => {
    expect(detectContentType("@@ -1,3 +1,3 @@")).toBe("diff");
    expect(detectContentType("+++ file.txt")).toBe("diff");
    expect(detectContentType("--- file.txt")).toBe("diff");
  });

  test("detects HTML/XML", () => {
    expect(detectContentType("<div>hello</div>")).toBe("html");
    expect(detectContentType("<xml>content</xml>")).toBe("html");
  });

  test("detects markdown", () => {
    expect(detectContentType("- List item")).toBe("markdown");
    expect(detectContentType("* List item")).toBe("markdown");
    expect(detectContentType("```code```")).toBe("markdown");
  });

  test("defaults to text", () => {
    expect(detectContentType("plain text")).toBe("text");
    expect(detectContentType("just some words")).toBe("text");
  });
});

describe("formatResultContent", () => {
  test("handles empty content", () => {
    expect(formatResultContent("")).toBe("*(No output)*\n\n");
    expect(formatResultContent(null)).toBe("*(No output)*\n\n");
    expect(formatResultContent(undefined)).toBe("*(No output)*\n\n");
  });

  test("formats short text without code blocks", () => {
    const result = formatResultContent("success");
    expect(result).toBe("**→** success\n\n");
  });

  test("formats long text with code blocks", () => {
    const longText =
      "This is a longer piece of text that should be formatted in a code block because it exceeds the short text threshold";
    const result = formatResultContent(longText);
    expect(result).toContain("**Result:**");
    expect(result).toContain("```text");
    expect(result).toContain(longText);
  });

  test("pretty prints JSON content", () => {
    const jsonContent = '{"key": "value", "number": 42}';
    const result = formatResultContent(jsonContent);
    expect(result).toContain("```json");
    expect(result).toContain('"key": "value"');
    expect(result).toContain('"number": 42');
  });

  test("truncates very long content", () => {
    const veryLongContent = "A".repeat(4000);
    const result = formatResultContent(veryLongContent);
    expect(result).toContain("...");
    // Should not contain the full long content
    expect(result.length).toBeLessThan(veryLongContent.length);
  });

  test("handles type:text structure", () => {
    const structuredContent = [{ type: "text", text: "Hello world" }];
    const result = formatResultContent(JSON.stringify(structuredContent));
    expect(result).toBe("**→** Hello world\n\n");
  });
});

describe("formatToolWithResult", () => {
  test("formats tool with parameters and result", () => {
    const toolUse: ToolUse = {
      type: "tool_use",
      name: "read_file",
      input: { file_path: "/path/to/file.txt" },
      id: "tool_123",
    };

    const toolResult: ToolResult = {
      type: "tool_result",
      tool_use_id: "tool_123",
      content: "File content here",
      is_error: false,
    };

    const result = formatToolWithResult(toolUse, toolResult);

    expect(result).toContain("### 🔧 `read_file`");
    expect(result).toContain("**Parameters:**");
    expect(result).toContain('"file_path": "/path/to/file.txt"');
    expect(result).toContain("**→** File content here");
  });

  test("formats tool with error result", () => {
    const toolUse: ToolUse = {
      type: "tool_use",
      name: "failing_tool",
      input: { param: "value" },
    };

    const toolResult: ToolResult = {
      type: "tool_result",
      content: "Permission denied",
      is_error: true,
    };

    const result = formatToolWithResult(toolUse, toolResult);

    expect(result).toContain("### 🔧 `failing_tool`");
    expect(result).toContain("❌ **Error:** `Permission denied`");
  });

  test("formats tool without parameters", () => {
    const toolUse: ToolUse = {
      type: "tool_use",
      name: "simple_tool",
    };

    const result = formatToolWithResult(toolUse);

    expect(result).toContain("### 🔧 `simple_tool`");
    expect(result).not.toContain("**Parameters:**");
  });

  test("handles unknown tool name", () => {
    const toolUse: ToolUse = {
      type: "tool_use",
    };

    const result = formatToolWithResult(toolUse);

    expect(result).toContain("### 🔧 `unknown_tool`");
  });
});

describe("groupTurnsNaturally", () => {
  test("groups assistant text messages", () => {
    const data: Turn[] = [{ role: "assistant", content: "Working on it." }];

    const grouped = groupTurnsNaturally(data);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.type).toBe("assistant_action");
    expect(grouped[0]!.text_parts).toEqual(["Working on it."]);
  });

  test("pairs tool calls with their results by tool_call_id", () => {
    const data: Turn[] = [
      {
        role: "assistant",
        tool_calls: [
          {
            type: "function",
            id: "tool_1",
            function: { name: "Bash", arguments: '{"command":"ls"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "tool_1", content: "file.txt" },
    ];

    const grouped = groupTurnsNaturally(data);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.tool_calls).toHaveLength(1);
    expect(grouped[0]!.tool_calls![0]!.tool_use.name).toBe("Bash");
    expect(grouped[0]!.tool_calls![0]!.tool_use.input).toEqual({
      command: "ls",
    });
    expect(grouped[0]!.tool_calls![0]!.tool_result?.content).toBe("file.txt");
    expect(grouped[0]!.tool_calls![0]!.tool_result?.is_error).toBe(false);
  });

  test("marks denied tool calls as errors", () => {
    const data: Turn[] = [
      {
        role: "assistant",
        tool_calls: [
          {
            type: "function",
            id: "tool_9",
            function: { name: "Bash", arguments: '{"command":"touch x"}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "tool_9",
        content: 'Tool "Bash" was denied by permission rule. Reason: no',
      },
    ];

    const grouped = groupTurnsNaturally(data);

    expect(grouped[0]!.tool_calls![0]!.tool_result?.is_error).toBe(true);
  });

  test("parses tool arguments JSON, falls back to raw text", () => {
    const data: Turn[] = [
      {
        role: "assistant",
        tool_calls: [
          {
            type: "function",
            id: "tool_bad",
            function: { name: "Bash", arguments: "not-json" },
          },
        ],
      },
    ];

    const grouped = groupTurnsNaturally(data);

    expect(grouped[0]!.tool_calls![0]!.tool_use.input).toEqual({
      arguments: "not-json",
    });
  });

  test("groups the session meta message", () => {
    const data: Turn[] = [
      { role: "assistant", content: "done" },
      {
        role: "meta",
        type: "session.resume_hint",
        session_id: "session_x",
        command: "kimi -r session_x",
      },
    ];

    const grouped = groupTurnsNaturally(data);

    expect(grouped).toHaveLength(2);
    expect(grouped[1]!.type).toBe("session_meta");
    expect(grouped[1]!.data?.session_id).toBe("session_x");
  });

  test("ignores assistant messages with no content and no tool calls", () => {
    const data: Turn[] = [{ role: "assistant" }];

    expect(groupTurnsNaturally(data)).toHaveLength(0);
  });
});

describe("formatGroupedContent", () => {
  test("starts with the Kimi Code Report header", () => {
    const markdown = formatGroupedContent([]);
    expect(markdown).toBe("## Kimi Code Report\n\n");
  });

  test("formats assistant text and tool calls", () => {
    const markdown = formatGroupedContent([
      {
        type: "assistant_action",
        text_parts: ["Reading files."],
        tool_calls: [
          {
            tool_use: {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/tmp/a.txt" },
            },
            tool_result: {
              type: "tool_result",
              content: "contents",
              is_error: false,
            },
          },
        ],
      },
    ]);

    expect(markdown).toContain("Reading files.");
    expect(markdown).toContain("### 🔧 `Read`");
    expect(markdown).toContain('"file_path": "/tmp/a.txt"');
    expect(markdown).toContain("**→** contents");
  });

  test("formats the session section", () => {
    const markdown = formatGroupedContent([
      {
        type: "session_meta",
        data: {
          role: "meta",
          type: "session.resume_hint",
          session_id: "session_y",
          command: "kimi -r session_y",
        },
      },
    ]);

    expect(markdown).toContain("## ✅ Session");
    expect(markdown).toContain("**Session ID:** `session_y`");
    expect(markdown).toContain("**Resume:** `kimi -r session_y`");
  });
});

describe("formatTurnsFromData", () => {
  test("handles empty data", () => {
    const result = formatTurnsFromData([]);
    expect(result).toBe("## Kimi Code Report\n\n");
  });

  test("formats a complete conversation", () => {
    const data: Turn[] = [
      { role: "assistant", content: "Let me look at the code." },
      {
        role: "assistant",
        tool_calls: [
          {
            type: "function",
            id: "tool_1",
            function: { name: "Grep", arguments: '{"pattern":"TODO"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "tool_1", content: "src/a.ts:10: TODO" },
      { role: "assistant", content: "Found one TODO item." },
      {
        role: "meta",
        type: "session.resume_hint",
        session_id: "session_z",
        command: "kimi -r session_z",
      },
    ];

    const markdown = formatTurnsFromData(data);

    expect(markdown).toContain("## Kimi Code Report");
    expect(markdown).toContain("Let me look at the code.");
    expect(markdown).toContain("### 🔧 `Grep`");
    expect(markdown).toContain("src/a.ts:10: TODO");
    expect(markdown).toContain("Found one TODO item.");
    expect(markdown).toContain("**Session ID:** `session_z`");
  });
});

describe("integration tests", () => {
  test("formats a real kimi execution log correctly", () => {
    const fixtureContent = readFileSync(
      join(__dirname, "fixtures", "sample-turns.jsonl"),
      "utf-8",
    );
    const expectedOutput = readFileSync(
      join(__dirname, "fixtures", "sample-turns-expected-output.md"),
      "utf-8",
    );

    const data = parseExecutionLog(fixtureContent);
    const markdown = formatTurnsFromData(data);

    expect(markdown.trim()).toBe(expectedOutput.trim());
    // Spot-check the important properties
    expect(markdown).toContain("## Kimi Code Report");
    expect(markdown).toContain("### 🔧 `Glob`");
    expect(markdown).toContain("### 🔧 `Bash`");
    expect(markdown).toContain("❌ **Error:**");
    expect(markdown).toContain("## ✅ Session");
  });
});

describe("detectContentType fallbacks", () => {
  test("falls back to text for malformed JSON objects", () => {
    expect(detectContentType('{"key": "value"')).toBe("text");
  });

  test("falls back to text for malformed JSON arrays", () => {
    expect(detectContentType("[1, 2, 3")).toBe("text");
  });

  test("classifies non-python, non-js code keywords as python by default", () => {
    expect(detectContentType("class Foo {}")).toBe("python");
  });
});

describe("formatResultContent non-string input", () => {
  test("handles a numeric (non-string) result value", () => {
    expect(formatResultContent(42)).toBe("**→** 42\n\n");
  });

  test("handles a plain object (non-string, non-text-array) result value", () => {
    const result = formatResultContent({ status: "ok" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
