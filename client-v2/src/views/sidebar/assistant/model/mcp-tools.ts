import type { McpServerEntry, McpTool } from "@/features/mcp";
import { callTool, sameConnection } from "@/features/mcp";
import type { ToolDefinition, ToolSchema } from "@/shared/lib/ai";
import { createLogger } from "@/shared/lib/logger";

import type { ToolApproval } from "../store";
import { PgAssistant } from "../store";

const log = createLogger("assistant:mcp-tools");

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
  } catch (e) {
    // The card then names the URL as written, which still says where it goes
    log.warn("MCP server URL does not parse; the card shows it as written", {
      context: { error: e },
    });
    return url;
  }
};

/**
 * The entry as it is after the user answered, when it still connects the way
 * the card showed (same URL and credentials); `undefined` when it changed or went
 */
const approvedEntry = (shown: McpServerEntry) =>
  PgAssistant.enabledMcpServers.find(
    (now) => now.id === shown.id && sameConnection(now, shown)
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
const toolApprovalFor =
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
      : await PgAssistant.requestApproval(
          toolApprovalFor(current, tool)(input)
        );
    if (approval && !approval.allowed) {
      return `The user declined to call ${tool.name} on ${current.name}.`;
    }
    // The card named this entry's host and credentials; one edited or removed
    // while it waited would send the arguments where the user never approved
    const target = approval ? approvedEntry(current) : current;
    if (approval && !target) {
      PgAssistant.setApprovalFailure(approval.id, "server changed, not called");
      return `Did not call ${tool.name}: the ${current.name} MCP server changed while the approval waited. Ask again if it is still needed.`;
    }
    const entry = target ?? current;
    PgAssistant.addToolCall(`${tool.name} on ${entry.name}`);
    try {
      const { text, isError } = await callTool(entry, tool.name, input, {
        signal: options?.signal,
      });
      if (approval && isError) {
        PgAssistant.setApprovalFailure(
          approval.id,
          "the tool reported an error"
        );
      } else if (approval) {
        PgAssistant.setApprovalOutcome(approval.id, "called");
      }
      return isError ? `The tool reported an error: ${text}` : text;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Stop ended the call, which is not the server failing
      if (options?.signal?.aborted) {
        if (approval)
          PgAssistant.setApprovalOutcome(
            approval.id,
            "stopped: the server may already have acted"
          );
      } else {
        PgAssistant.addToolCall(`${tool.name} on ${entry.name} failed`);
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
