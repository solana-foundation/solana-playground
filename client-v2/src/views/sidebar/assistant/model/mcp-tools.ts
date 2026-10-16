import { PgAssistant } from "../store";
import { callTool } from "../grounding";
import type { McpServerEntry, McpTool } from "../grounding";
import type { ToolDefinition, ToolSchema } from "./types";

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
  run: async (input) => {
    PgAssistant.addToolCall(`${tool.name} on ${server.name}`);
    try {
      const { text, isError } = await callTool(server, tool.name, input);
      return isError ? `The tool reported an error: ${text}` : text;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      PgAssistant.addToolCall(`${tool.name} on ${server.name} failed`);
      return `Could not call ${tool.name}: ${message}`;
    }
  },
});

/**
 * MCP tools the browser can execute, as ordinary tool definitions.
 *
 * This is what makes MCP a per-server matter rather than an Anthropic one: the
 * definitions are vendor-neutral, so any backend that calls tools gets them.
 * Servers whose executor is `server` are absent — the connector declares those
 * itself, and declaring them here too would show the model each tool twice.
 *
 * Reads the discovery cache rather than the network, because `createTools()` is
 * synchronous. A server not yet discovered contributes nothing this turn.
 *
 * @returns vendor-neutral definitions for every discovered browser server
 */
export const createMcpTools = (): ToolDefinition[] =>
  PgAssistant.enabledMcpServers
    .filter((server) => server.executor === "browser")
    .flatMap((server) =>
      (PgAssistant.mcpTools[server.id] ?? []).map((tool) =>
        define(server, tool)
      )
    );
