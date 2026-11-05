// 给 child 的工具结果里带图片（工单 #231）。
// 工具结果里要给模型看图片时，处理函数返回这个形状（agentToolContent）：MCP 服务器和 pi 的扩展把它原样当作结果的内容，
// 不再包成一段 JSON 文字。经过 daemon 的工具桥时它是普通的 JSON，照样认得出。
export const AGENT_TOOL_CONTENT = "agent_tool_content";
export type AgentToolContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export function agentToolContent(content: AgentToolContentBlock[]): { [AGENT_TOOL_CONTENT]: AgentToolContentBlock[] } {
  return { [AGENT_TOOL_CONTENT]: content };
}

/** 处理函数的结果是不是 agentToolContent 的形状：是时返回内容，不是时返回 null。 */
export function agentToolContentOf(value: unknown): AgentToolContentBlock[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const content = (value as Record<string, unknown>)[AGENT_TOOL_CONTENT];
  if (!Array.isArray(content)) return null;
  const valid = content.every((block) => block && typeof block === "object"
    && ((block.type === "text" && typeof block.text === "string")
      || (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string")));
  return valid ? content as AgentToolContentBlock[] : null;
}

/** MCP 的 tools/call 成功时的结果：带图片的结果原样当作内容；别的结果是一段 JSON 文字加 structuredContent。 */
export function mcpToolCallResult(value: unknown): { content: unknown[]; structuredContent?: unknown; isError: false } {
  const content = agentToolContentOf(value);
  if (content) return { content, isError: false };
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError: false };
}
