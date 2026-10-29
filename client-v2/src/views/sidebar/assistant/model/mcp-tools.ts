import { PgAssistant } from "../store";
import { callTool } from "@/features/mcp";
import type { McpServerEntry, McpTool } from "@/features/mcp";
import type { ToolDefinition, ToolSchema } from "@/shared/lib/ai";

/** Separates the server from the tool, and is legal in every provider's names */
const SEPARATOR = "__";

/**
 * Adapt an MCP tool's own schema to ours.
 *
 * MCP publishes JSON Schema, which is what we pass on, but a server may omit
 * `properties` or send a non-object schema. Falling back to an empty object
 * schema keeps a usable tool rather than dropping it.
 */
const schemaFor = (tool: McpTool): ToolSchema => {
  const schema = tool.inputSchema;
  const properties = schema?.properties;

  return {
    type: "object",
    properties:
      properties && typeof properties === "object"
        ? (properties as Record<string, unknown>)
        : {},
    ...(Array.isArray(schema?.required)
      ? { required: schema?.required as string[] }
      : {}),
    additionalProperties: false,
  };
};

const define = (server: McpServerEntry, tool: McpTool): ToolDefinition => ({
  // Prefixed so two servers offering the same tool name cannot collide
  name: `${server.id}${SEPARATOR}${tool.name}`,
  description: tool.description
    ? `${tool.description} (from the ${server.name} MCP server)`
    : `The ${tool.name} tool on the ${server.name} MCP server.`,
  schema: schemaFor(tool),
  run: async (input, options) => {
    // The entry as it is now: one edited mid-turn must not be called with its old URL or token
    const current = PgAssistant.enabledMcpServers.find(
      (entry) => entry.id === server.id
    );
    if (!current) {
      return `Could not call ${tool.name}: the ${server.name} MCP server was removed or turned off.`;
    }
    PgAssistant.addToolCall(`${tool.name} on ${current.name}`);
    try {
      const { text, isError } = await callTool(current, tool.name, input, {
        signal: options?.signal,
      });
      return isError ? `The tool reported an error: ${text}` : text;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Stop ended the call, which is not the server failing
      if (!options?.signal?.aborted) {
        PgAssistant.addToolCall(`${tool.name} on ${current.name} failed`);
      }
      return `Could not call ${tool.name}: ${message}`;
    }
  },
});

/**
 * MCP tools, as ordinary tool definitions, so any backend that calls tools gets them.
 * Reads the discovery cache, because `createTools()` is synchronous: a server not
 * yet discovered contributes nothing this turn.
 */
export const createMcpTools = (): ToolDefinition[] =>
  PgAssistant.enabledMcpServers.flatMap((server) =>
    (PgAssistant.mcpTools[server.id] ?? []).map((tool) => define(server, tool))
  );
