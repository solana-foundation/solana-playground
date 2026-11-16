import type { McpServerEntry, McpTool } from "@/features/mcp";
import { callTool } from "@/features/mcp";
import type { ToolDefinition, ToolSchema } from "@/shared/lib/ai";

import type { ToolApproval } from "../store";
import { PgAssistant } from "../store";

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

/** The host a server's calls go to, or its URL as written when it does not parse */
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Whether the entry is still enabled and still points where it did */
const sameTarget = (entry: McpServerEntry) =>
  PgAssistant.enabledMcpServers.some(
    (now) => now.id === entry.id && now.url === entry.url
  );

/** Whether the entry carries a credential of the user's, sent with every call */
const hasCredentials = (entry: McpServerEntry) =>
  Boolean(
    entry.authToken ||
      entry.protection ||
      Object.keys(entry.queryParams ?? {}).length ||
      Object.keys(entry.headers ?? {}).length
  );

/**
 * The card a call to a user-added server waits on. The host comes from the
 * entry's own URL, never from anything the server or the model reports
 */
const toolApprovalOf =
  (server: McpServerEntry, tool: McpTool) =>
  (input: unknown): ToolApproval => {
    const host = hostOf(server.url);
    return {
      type: "tool",
      server: server.name,
      tool: tool.name,
      host,
      input: JSON.stringify(input ?? {}, undefined, 2),
      effect: hasCredentials(server)
        ? `Sends these arguments to ${host}, with the credentials you saved for ${server.name}.`
        : `Sends these arguments to ${host}.`,
      question: `Call ${tool.name} on ${server.name}?`,
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
    // The user's own server acts with the user's credentials, so a call waits
    // for their answer; the gateway's servers are the operator's (HOO-2877)
    const approval = PgAssistant.isGatewayMcpServer(current.id)
      ? undefined
      : await PgAssistant.requestApproval(toolApprovalOf(current, tool)(input));
    if (approval && !approval.allowed) {
      return `The user declined to call ${tool.name} on ${current.name}.`;
    }
    // The card named this URL's host; an entry edited or removed while it
    // waited would send the arguments somewhere the user never approved
    if (approval && !sameTarget(current)) {
      PgAssistant.setApprovalFailure(approval.id, "server changed, not called");
      return `Did not call ${tool.name}: the ${current.name} MCP server changed while the approval waited. Ask again if it is still needed.`;
    }
    PgAssistant.addToolCall(`${tool.name} on ${current.name}`);
    try {
      const { text, isError } = await callTool(current, tool.name, input, {
        signal: options?.signal,
      });
      if (approval) {
        PgAssistant.setApprovalOutcome(
          approval.id,
          isError ? "the tool reported an error" : "called"
        );
      }
      return isError ? `The tool reported an error: ${text}` : text;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Stop ended the call, which is not the server failing
      if (!options?.signal?.aborted) {
        PgAssistant.addToolCall(`${tool.name} on ${current.name} failed`);
        if (approval) {
          PgAssistant.setApprovalFailure(
            approval.id,
            `call failed: ${message}`
          );
        }
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
