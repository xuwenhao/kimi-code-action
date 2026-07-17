#!/usr/bin/env bun

import { readFileSync, existsSync } from "fs";
import { exit } from "process";

export type ToolUse = {
  type: string;
  name?: string;
  input?: Record<string, any>;
  id?: string;
};

export type ToolResult = {
  type: string;
  tool_use_id?: string;
  content?: any;
  is_error?: boolean;
};

/**
 * One line of kimi's stream-json output (see docs/kimi-headless-notes.md):
 * - assistant messages carry text `content` and/or `tool_calls`
 * - tool messages carry the tool output in `content`, keyed by `tool_call_id`
 * - a final meta message (`type: "session.resume_hint"`) carries the session id
 */
export type Turn = {
  role?: string;
  type?: string;
  content?: unknown;
  tool_calls?: Array<{
    type?: string;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
  session_id?: string;
  command?: string;
};

export type GroupedContent = {
  type: string;
  data?: Turn;
  text_parts?: string[];
  tool_calls?: { tool_use: ToolUse; tool_result?: ToolResult }[];
};

/**
 * Parse an execution log (JSONL, one stream-json message per line) into
 * turns. Lines that fail to parse are skipped — the runner already warned
 * about them when they were emitted.
 */
export function parseExecutionLog(content: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      turns.push(JSON.parse(trimmed) as Turn);
    } catch {
      // Skip non-JSON lines
    }
  }
  return turns;
}

/**
 * Parse a tool_calls arguments string (JSON) into an object for display.
 */
function parseToolArguments(
  rawArguments: string | undefined,
): Record<string, any> {
  if (!rawArguments) return {};
  try {
    const parsed = JSON.parse(rawArguments);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, any>)
      : { value: parsed };
  } catch {
    return { arguments: rawArguments };
  }
}

export function detectContentType(content: any): string {
  const contentStr = String(content).trim();

  // Check for JSON
  if (contentStr.startsWith("{") && contentStr.endsWith("}")) {
    try {
      JSON.parse(contentStr);
      return "json";
    } catch {
      // Fall through
    }
  }

  if (contentStr.startsWith("[") && contentStr.endsWith("]")) {
    try {
      JSON.parse(contentStr);
      return "json";
    } catch {
      // Fall through
    }
  }

  // Check for code-like content
  const codeKeywords = [
    "def ",
    "class ",
    "import ",
    "from ",
    "function ",
    "const ",
    "let ",
    "var ",
  ];
  if (codeKeywords.some((keyword) => contentStr.includes(keyword))) {
    if (
      contentStr.includes("def ") ||
      contentStr.includes("import ") ||
      contentStr.includes("from ")
    ) {
      return "python";
    } else if (
      ["function ", "const ", "let ", "var ", "=>"].some((js) =>
        contentStr.includes(js),
      )
    ) {
      return "javascript";
    } else {
      return "python"; // default for code
    }
  }

  // Check for shell/bash output
  const shellIndicators = ["ls -", "cd ", "mkdir ", "rm ", "$ ", "# "];
  if (
    contentStr.startsWith("/") ||
    contentStr.includes("Error:") ||
    contentStr.startsWith("total ") ||
    shellIndicators.some((indicator) => contentStr.includes(indicator))
  ) {
    return "bash";
  }

  // Check for diff format
  if (
    contentStr.startsWith("@@") ||
    contentStr.includes("+++ ") ||
    contentStr.includes("--- ")
  ) {
    return "diff";
  }

  // Check for HTML/XML
  if (contentStr.startsWith("<") && contentStr.endsWith(">")) {
    return "html";
  }

  // Check for markdown
  const mdIndicators = ["# ", "## ", "### ", "- ", "* ", "```"];
  if (mdIndicators.some((indicator) => contentStr.includes(indicator))) {
    return "markdown";
  }

  // Default to plain text
  return "text";
}

export function formatResultContent(content: any): string {
  if (!content) {
    return "*(No output)*\n\n";
  }

  let contentStr: string;

  // Check if content is a list with "type": "text" structure
  try {
    let parsedContent: any;
    if (typeof content === "string") {
      parsedContent = JSON.parse(content);
    } else {
      parsedContent = content;
    }

    if (
      Array.isArray(parsedContent) &&
      parsedContent.length > 0 &&
      typeof parsedContent[0] === "object" &&
      parsedContent[0]?.type === "text"
    ) {
      // Extract the text field from the first item
      contentStr = parsedContent[0]?.text || "";
    } else {
      contentStr = String(content).trim();
    }
  } catch {
    contentStr = String(content).trim();
  }

  // Truncate very long results
  if (contentStr.length > 3000) {
    contentStr = contentStr.substring(0, 2997) + "...";
  }

  // Detect content type
  const contentType = detectContentType(contentStr);

  // Handle JSON content specially - pretty print it
  if (contentType === "json") {
    try {
      // Try to parse and pretty print JSON
      const parsed = JSON.parse(contentStr);
      contentStr = JSON.stringify(parsed, null, 2);
    } catch {
      // Keep original if parsing fails
    }
  }

  // Format with appropriate syntax highlighting
  if (
    contentType === "text" &&
    contentStr.length < 100 &&
    !contentStr.includes("\n")
  ) {
    // Short text results don't need code blocks
    return `**→** ${contentStr}\n\n`;
  } else {
    return `**Result:**\n\`\`\`${contentType}\n${contentStr}\n\`\`\`\n\n`;
  }
}

export function formatToolWithResult(
  toolUse: ToolUse,
  toolResult?: ToolResult,
): string {
  const toolName = toolUse.name || "unknown_tool";
  const toolInput = toolUse.input || {};

  let result = `### 🔧 \`${toolName}\`\n\n`;

  // Add parameters if they exist and are not empty
  if (Object.keys(toolInput).length > 0) {
    result += "**Parameters:**\n```json\n";
    result += JSON.stringify(toolInput, null, 2);
    result += "\n```\n\n";
  }

  // Add result if available
  if (toolResult) {
    const content = toolResult.content || "";
    const isError = toolResult.is_error || false;

    if (isError) {
      result += `❌ **Error:** \`${content}\`\n\n`;
    } else {
      result += formatResultContent(content);
    }
  }

  return result;
}

export function groupTurnsNaturally(data: Turn[]): GroupedContent[] {
  const groupedContent: GroupedContent[] = [];
  const toolResultsMap = new Map<string, ToolResult>();

  // First pass: collect all tool results by tool_call_id
  for (const turn of data) {
    if (turn.role === "tool" && turn.tool_call_id) {
      const content = typeof turn.content === "string" ? turn.content : "";
      toolResultsMap.set(turn.tool_call_id, {
        type: "tool_result",
        tool_use_id: turn.tool_call_id,
        content: turn.content,
        is_error: content.includes("was denied by permission rule"),
      });
    }
  }

  // Second pass: process turns and group naturally
  for (const turn of data) {
    if (turn.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: { tool_use: ToolUse; tool_result?: ToolResult }[] = [];

      if (typeof turn.content === "string" && turn.content.trim()) {
        textParts.push(turn.content);
      }

      for (const call of turn.tool_calls ?? []) {
        const toolResult = call.id ? toolResultsMap.get(call.id) : undefined;
        toolCalls.push({
          tool_use: {
            type: "tool_use",
            name: call.function?.name,
            input: parseToolArguments(call.function?.arguments),
            id: call.id,
          },
          tool_result: toolResult,
        });
      }

      if (textParts.length > 0 || toolCalls.length > 0) {
        groupedContent.push({
          type: "assistant_action",
          text_parts: textParts,
          tool_calls: toolCalls,
        });
      }
    } else if (turn.role === "meta" && turn.type === "session.resume_hint") {
      groupedContent.push({
        type: "session_meta",
        data: turn,
      });
    }
    // tool messages are consumed via the results map above
  }

  return groupedContent;
}

export function formatGroupedContent(groupedContent: GroupedContent[]): string {
  let markdown = "## Kimi Code Report\n\n";

  for (const item of groupedContent) {
    const itemType = item.type;

    if (itemType === "assistant_action") {
      // Add text content first (if any) - no header needed
      for (const text of item.text_parts || []) {
        if (text.trim()) {
          markdown += `${text}\n\n`;
        }
      }

      // Add tool calls with their results
      for (const toolCall of item.tool_calls || []) {
        markdown += formatToolWithResult(
          toolCall.tool_use,
          toolCall.tool_result,
        );
      }

      // Only add separator if this section had content
      if (
        (item.text_parts && item.text_parts.length > 0) ||
        (item.tool_calls && item.tool_calls.length > 0)
      ) {
        markdown += "---\n\n";
      }
    } else if (itemType === "session_meta") {
      const data = item.data || {};
      markdown += "## ✅ Session\n\n";
      if (data.session_id) {
        markdown += `**Session ID:** \`${data.session_id}\`\n\n`;
      }
      if (data.command) {
        markdown += `**Resume:** \`${data.command}\`\n\n`;
      }
    }
  }

  return markdown;
}

export function formatTurnsFromData(data: Turn[]): string {
  // Group turns naturally
  const groupedContent = groupTurnsNaturally(data);

  // Generate markdown
  const markdown = formatGroupedContent(groupedContent);

  return markdown;
}

function main(): void {
  // Get the JSONL file path from command line arguments
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: format-turns.ts <jsonl-file>");
    exit(1);
  }

  const jsonlFile = args[0];
  if (!jsonlFile) {
    console.error("Error: No JSONL file provided");
    exit(1);
  }

  if (!existsSync(jsonlFile)) {
    console.error(`Error: ${jsonlFile} not found`);
    exit(1);
  }

  try {
    // Read the execution log (one stream-json message per line)
    const fileContent = readFileSync(jsonlFile, "utf-8");
    const data = parseExecutionLog(fileContent);

    // Group turns naturally
    const groupedContent = groupTurnsNaturally(data);

    // Generate markdown
    const markdown = formatGroupedContent(groupedContent);

    // Print to stdout (so it can be captured by shell)
    console.log(markdown);
  } catch (error) {
    console.error(`Error processing file: ${error}`);
    exit(1);
  }
}

if (import.meta.main) {
  main();
}
