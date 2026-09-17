import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

import { createTools } from "./tools";
import { describeProject, systemPrompt } from "./prompt";
import { PgAssistant } from "../store";
import { PROVIDERS } from "./types";
import { serverUrl } from "../grounding";
import type { ReplayMessage } from "../../../../features/persistence/model/replay";
import type { McpServerEntry } from "../grounding";
import type { Effort, Provider, ToolInput } from "./types";

const MAX_TOKENS = 32000;
/** A turn that has not finished after this many round trips is looping */
const MAX_ITERATIONS = 12;
/** Remote MCP servers are dialled by Anthropic, not from the browser */
const MCP_BETA = "mcp-client-2025-11-20";
/** A turn still pausing after this many resumes is not going to finish */
const MAX_RESUMES = 3;

/**
 * Declare the enabled MCP servers, and the toolsets that expose them.
 *
 * Both halves go together: the API rejects a declared server that no toolset
 * references. An entry's `headers` is deliberately not sent — the connector's
 * server definition has no header map. See `docs/decisions.md` -> D12.
 *
 * @param servers the user's enabled servers
 * @returns request fragments, or `null` when there is nothing to declare
 */
const declareMcp = (servers: readonly McpServerEntry[]) => {
  if (!servers.length) return null;

  return {
    betas: [MCP_BETA],
    mcp_servers: servers.map((server) => ({
      type: "url" as const,
      name: server.id,
      url: serverUrl(server),
      ...(server.authToken?.trim()
        ? { authorization_token: server.authToken.trim() }
        : {}),
    })),
    toolsets: servers.map((server) => ({
      type: "mcp_toolset" as const,
      mcp_server_name: server.id,
    })),
  };
};

/**
 * Anthropic, driven by the SDK's tool runner.
 *
 * The runner owns the loop; the approval gate lives inside each tool's `run`,
 * which does not return until the user clicks. MCP tools are the exception —
 * they execute on Anthropic's side, so they never reach a `run`.
 *
 * @param apiKey the user's key
 * @param settings model and effort, both cost levers; falls back to the
 * connect screen's defaults
 */
export const createAnthropicProvider = (
  apiKey: string,
  settings?: { model: string; effort: Effort },
  /**
   * Prior turns to start from, when a stored thread is reopened.
   *
   * Text only: the panel keeps a render model, not a wire transcript, so tool
   * calls and their results were never stored and are not reconstructed. The
   * model gets the conversation from here and the current project from
   * `describeProject`, which is re-sent every turn -- see
   * `features/persistence/model/replay.ts`.
   */
  seed: readonly ReplayMessage[] = []
): Provider => {
  const defaults = PROVIDERS.find((p) => p.id === "anthropic")!.modelSettings!
    .defaults;
  const model = settings?.model ?? defaults.model;
  const effort = settings?.effort ?? defaults.effort;

  const client = new Anthropic({
    apiKey,
    // The key is the user's own and goes only to Anthropic. See
    // docs/decisions.md -> D3 for why it is not persisted anywhere.
    dangerouslyAllowBrowser: true,
  });

  const tools = createTools().map((tool) =>
    betaTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.schema as never,
      run: (args) => Promise.resolve(tool.run(args as ToolInput)),
    })
  );

  let history: Anthropic.Beta.BetaMessageParam[] = seed.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return {
    id: "anthropic",
    label: model,

    async send(input, signal) {
      // Read per turn, so toggling a server applies without reconnecting.
      // Only `server`-executor entries go to the connector — the rest are
      // called from the browser and reach the model as ordinary tools, so
      // declaring them here too would show the model each one twice.
      const servers = PgAssistant.enabledMcpServers.filter(
        (server) => server.executor === "server"
      );
      const mcp = declareMcp(servers);
      const serverName = (id: string) =>
        servers.find((server) => server.id === id)?.name ?? id;

      const runner = client.beta.messages.toolRunner(
        {
          model,
          max_tokens: MAX_TOKENS,
          thinking: { type: "adaptive" },
          output_config: { effort },
          system: [
            {
              type: "text",
              text: systemPrompt(),
              // Stable across turns, so it is a cache read after the first
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: `Current project state:\n\n${describeProject()}`,
            },
          ],
          tools: [...tools, ...(mcp?.toolsets ?? [])],
          ...(mcp ? { mcp_servers: mcp.mcp_servers, betas: mcp.betas } : {}),
          messages: [...history, { role: "user", content: input }],
          max_iterations: MAX_ITERATIONS,
          stream: true,
        },
        { signal }
      );

      // MCP results carry only the call's id, so remember what each one was
      const mcpCalls = new Map<string, string>();
      let resumes = 0;

      for await (const stream of runner) {
        const messageId = PgAssistant.startAssistantMessage();

        for await (const event of stream) {
          if (event.type === "content_block_start") {
            const block = event.content_block;
            // MCP tools run on Anthropic's side, so they arrive as their own
            // block types and never pass through a local `run`
            if (block.type === "mcp_tool_use") {
              const label = `${block.name} on ${serverName(block.server_name)}`;
              mcpCalls.set(block.id, label);
              PgAssistant.addToolCall(label);
            } else if (block.type === "mcp_tool_result" && block.is_error) {
              const label = mcpCalls.get(block.tool_use_id) ?? "an MCP tool";
              PgAssistant.addToolCall(`${label} failed`);
            }
          } else if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            PgAssistant.appendToAssistantMessage(messageId, event.delta.text);
          }
        }

        // A turn that only called tools produces no text; drop the empty bubble
        PgAssistant.discardIfEmpty(messageId);

        // A tool may have waited on an approval; stop before the next request
        signal?.throwIfAborted();

        // A long MCP round can stop the turn early. The runner only continues
        // after a local tool runs, so without this the answer is cut off
        // mid-thought with no error.
        const message = await stream.finalMessage();
        if (message.stop_reason === "pause_turn") {
          if (++resumes > MAX_RESUMES) {
            throw new Error(
              `The turn paused ${resumes} times without finishing — stopped it.`
            );
          }
          runner.pushMessages({ role: "assistant", content: message.content });
        }
      }

      history = runner.params.messages as Anthropic.Beta.BetaMessageParam[];
    },
  };
};
