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

/** Thinking counts toward this even though its text is not returned */
const MAX_TOKENS = 64000;
/** A turn that has not finished after this many round trips is looping */
const MAX_ITERATIONS = 12;
/** Remote MCP servers are dialled by Anthropic, not from the browser */
const MCP_BETA = "mcp-client-2025-11-20";
/** A turn still pausing after this many resumes is not going to finish */
const MAX_RESUMES = 3;
/** `block_binding`, `display: "updates"` and `fallbacks: "default"` */
const BETAS = [
  "thinking-binding-controls-2026-08-01",
  "thinking-display-updates-2026-08-18",
  "server-side-fallback-2026-07-01",
];

/**
 * The project snapshot, the skill catalogue and the MCP toolsets change between
 * turns, so earlier thinking blocks no longer match their prefix: drop them
 * rather than fail the request. `updates` returns the notes written between
 * tool calls, which the 5.5 models send as thinking blocks, not text.
 *
 * Cast because SDK 0.117 types `thinking` without either field.
 */
const THINKING = {
  type: "adaptive",
  display: "updates",
  block_binding: { prefix_mismatch_behavior: "drop_block" },
} as unknown as Anthropic.Beta.BetaThinkingConfigParam;

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
    // The key is the user's own and goes only to Anthropic, as `x-api-key`.
    // It is kept for this tab in `sessionStorage`; see `remembered-backend`.
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
          thinking: THINKING,
          output_config: { effort },
          // A classifier decline is retried on the model Anthropic picks for it
          fallbacks: "default",
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
          ...(mcp ? { mcp_servers: mcp.mcp_servers } : {}),
          betas: [...BETAS, ...(mcp?.betas ?? [])],
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
        // Progress notes and the reply are separate blocks; a blank line keeps
        // them separate paragraphs in the one bubble
        let wrote = false;
        let newBlock = false;
        const write = (delta: string) => {
          if (!delta) return;
          if (newBlock && wrote) {
            PgAssistant.appendToAssistantMessage(messageId, "\n\n");
          }
          PgAssistant.appendToAssistantMessage(messageId, delta);
          wrote = true;
          newBlock = false;
        };

        for await (const event of stream) {
          if (event.type === "content_block_start") {
            newBlock = true;
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
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") write(event.delta.text);
            else if (event.delta.type === "thinking_delta") {
              write(event.delta.thinking);
            }
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
        // Reached only when the fallback declined too, or the category has none
        if (message.stop_reason === "refusal") {
          const category = message.stop_details?.category;
          throw new Error(
            `The model declined this request${
              category ? ` (${category})` : ""
            }. Rephrase it, or switch backends.`
          );
        }
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
