import { createTools } from "./tools";
import { describeProject, systemPrompt } from "./prompt";
import { PgAssistant } from "../store";
import type { ReplayMessage } from "../../../../features/persistence/model/replay";
import type { Provider, ProviderId, ToolDefinition, ToolInput } from "./types";

/** A turn that has not finished after this many round trips is looping */
const MAX_ITERATIONS = 12;

/** Everything needed to talk to one OpenAI-compatible endpoint */
export interface OpenAiConfig {
  id: ProviderId;
  /** e.g. `https://api.openai.com/v1` — no trailing slash, no `/chat/...` */
  baseUrl: string;
  model: string;
  /** Empty for endpoints that do not check one (local proxies) */
  apiKey: string;
  /** Whole endpoint URL, for a backend not laid out as `${baseUrl}/chat/completions` */
  url?: string;
  /** Shown in the panel footer; defaults to the model id */
  label?: string;
}

/** The slice of a chat-completions message the loop needs to carry */
interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /**
   * Vendor extras echoed back untouched. Gemini puts a `thought_signature`
   * here and rejects the next request with 400 if it does not come back.
   */
  extra_content?: unknown;
}

/**
 * Any OpenAI-compatible backend: OpenAI itself, OpenRouter, a local proxy.
 *
 * Plain `fetch` against `/chat/completions` — no SDK, so the same code serves
 * every endpoint that speaks the protocol. The loop is ours: stream text,
 * collect tool calls, run them (each tool gates itself on user approval),
 * feed results back, repeat until the model stops calling tools.
 */
export const createOpenAiProvider = (
  config: OpenAiConfig,
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
  const tools = createTools();
  const history: ChatMessage[] = seed.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return {
    id: config.id,
    label: config.label ?? config.model,

    async send(input, signal) {
      history.push({ role: "user", content: input });
      let ranTool = false;

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const message = await streamOneCompletion(
          config,
          tools,
          history,
          signal
        );
        history.push(message);

        if (!message.tool_calls?.length) {
          // Neither text nor a tool call. A turn that already did its work and
          // simply had nothing to add ends quietly — telling the user to retry
          // would run the tools a second time.
          if (!message.content && !ranTool) {
            PgAssistant.addError(
              `${
                config.label ?? config.model
              } returned an empty response. Try again, or pick another model.`
            );
          }
          return;
        }

        ranTool = true;

        for (const call of message.tool_calls) {
          // A tool can sit on an approval for a long time; do not start the
          // next one, or the next request, once the user has stopped the turn
          signal?.throwIfAborted();
          history.push({
            role: "tool",
            tool_call_id: call.id,
            content: await runToolCall(tools, call),
          });
        }

        signal?.throwIfAborted();
      }

      throw new Error(
        `The model was still calling tools after ${MAX_ITERATIONS} rounds — stopped it.`
      );
    },
  };
};

const runToolCall = async (tools: ToolDefinition[], call: ToolCall) => {
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) return `Unknown tool: ${call.function.name}`;

  let input: ToolInput;
  try {
    input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return "The tool arguments were not valid JSON. Send them again.";
  }

  try {
    return await tool.run(input);
  } catch (e) {
    return `The tool failed: ${e instanceof Error ? e.message : String(e)}`;
  }
};

/**
 * One request: stream the text into the store as it arrives, and return the
 * finished assistant message (text plus any tool calls) for the history.
 */
const streamOneCompletion = async (
  config: OpenAiConfig,
  tools: ToolDefinition[],
  history: ChatMessage[],
  signal?: AbortSignal
): Promise<ChatMessage> => {
  const response = await fetch(
    config.url ?? `${config.baseUrl}/chat/completions`,
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        // The key is the user's own and goes only to the endpoint they typed in.
        // See docs/decisions.md -> D3 for why it is not persisted anywhere.
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt() },
          {
            role: "system",
            content: `Current project state:\n\n${describeProject()}`,
          },
          ...history,
        ],
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.schema,
          },
        })),
      }),
    }
  );

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${response.status} ${response.statusText}${
        body ? ` — ${body.slice(0, 300)}` : ""
      }`
    );
  }

  const messageId = PgAssistant.startAssistantMessage();
  let text = "";
  // Deltas address calls by index; ids and names arrive on the first delta
  const calls: ToolCall[] = [];

  try {
    for await (const data of sseEvents(response.body)) {
      // An upstream that fails after the headers reports it in the stream; without
      // this the turn just ends empty and the panel blames the model
      if (data.error) {
        throw new Error(data.error.message ?? "The backend reported an error.");
      }

      const delta = data.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        PgAssistant.appendToAssistantMessage(messageId, delta.content);
      }

      for (const part of delta.tool_calls ?? []) {
        // Gemini's OpenAI shim omits `index` and sends each call whole, so an
        // indexless part is a new call rather than a fragment of the last one
        const call = (calls[part.index ?? calls.length] ??= {
          id: "",
          type: "function",
          function: { name: "", arguments: "" },
        });
        if (part.id) call.id = part.id;
        if (part.extra_content) call.extra_content = part.extra_content;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) {
          call.function.arguments += part.function.arguments;
        }
      }
    }
  } finally {
    // A round that only called tools produces no text; drop the empty bubble
    PgAssistant.discardIfEmpty(messageId);
  }

  return {
    role: "assistant",
    content: text || null,
    ...(calls.length ? { tool_calls: calls.filter((c) => c.id) } : {}),
  };
};

/** Parse an SSE body into the JSON payload of each `data:` event */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{
  error?: { message?: string };
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        /** Absent on some shims (Gemini) */
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
        extra_content?: unknown;
      }>;
    };
  }>;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; keep the unfinished tail
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          try {
            yield JSON.parse(payload);
          } catch {
            // A malformed chunk is the endpoint's bug; skip it, keep streaming
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
