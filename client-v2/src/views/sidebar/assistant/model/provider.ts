import { loadAi } from "@/shared/lib/ai";
import { createTools } from "./tools";
import { describeProject, systemPrompt } from "./prompt";
import { PgAssistant } from "../store";
import { PgSession, SIGNED_OUT_REASON } from "../../../../features/auth";
import { isDefaultBackend, PROVIDERS } from "./types";
import type { JSONValue, LanguageModel, ModelMessage } from "ai";
import type {
  AiTurnError,
  ModelConnection,
  ModelProvider,
} from "@/shared/lib/ai";
import type { ReplayMessage } from "../../../../features/persistence/model/replay";
import type { Effort, Provider } from "./types";

/** What a provider needs to be built: structurally the store's `Connection` */
export interface ProviderConnection {
  id: ModelProvider;
  apiKey: string;
  /** Base URL and model, for OpenAI-compatible backends */
  endpoint?: { baseUrl: string; model: string };
  /** Model and effort, for backends that pick them without a base URL */
  settings?: { model: string; effort: Effort };
}

type ProviderOptions = Record<string, Record<string, JSONValue>>;

/** Everything that differs between backends, as data for the one turn loop */
interface Backend {
  connection: ModelConnection;
  /** Shown in the panel footer and in the empty-response error */
  label: string;
  /** Whether the model's reasoning reaches the reply bubble */
  showsReasoning: boolean;
  providerOptions?: ProviderOptions;
  /** Set on the first system message, which is stable across turns */
  promptOptions?: ProviderOptions;
  maxOutputTokens?: number;
}

const defaultsOf = (id: ModelProvider) => PROVIDERS.find((p) => p.id === id)!;

/**
 * The backend profile for a connection. Anthropic drops thinking blocks whose prefix
 * changed (the project snapshot moves between turns); `updates` returns the progress notes.
 */
const backendFor = ({
  id,
  apiKey,
  endpoint,
  settings,
}: ProviderConnection): Backend => {
  switch (id) {
    // The model is the server's to pick, so none is sent and none is shown
    case "default":
      return {
        connection: { provider: "default" },
        label: "default backend",
        showsReasoning: false,
      };
    case "anthropic": {
      const { model, effort } =
        settings ?? defaultsOf(id).modelSettings!.defaults;
      return {
        connection: { provider: "anthropic", apiKey, model },
        label: model,
        showsReasoning: true,
        providerOptions: {
          anthropic: {
            thinking: {
              type: "adaptive",
              display: "updates",
              blockBinding: { prefixMismatchBehavior: "drop_block" },
            },
            effort,
            // A classifier decline is retried on the model Anthropic picks for it
            fallbacks: "default",
          },
        },
        // Stable across turns, so it is a cache read after the first
        promptOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        // Thinking counts toward this even though its text is not returned
        maxOutputTokens: 64000,
      };
    }
    case "openai":
    case "openrouter":
    case "gemini": {
      const { baseUrl, model } = endpoint ?? defaultsOf(id).endpoint!;
      return {
        connection: { provider: id, apiKey, baseUrl, model },
        label: model,
        showsReasoning: false,
      };
    }
  }
};

/**
 * The sentence `/api/agent` refuses a signed-out turn with, or `undefined` for
 * any other failure. Read only from our own backend, so another endpoint can
 * never put its text in front of the user this way.
 */
const signedOutRefusal = (
  id: ModelProvider,
  error: AiTurnError
): string | undefined => {
  if (!isDefaultBackend(id) || error.status !== 401 || !error.body) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(error.body);
    return parsed?.reason === SIGNED_OUT_REASON &&
      typeof parsed.error === "string"
      ? parsed.error
      : undefined;
  } catch {
    // Not JSON, so not our backend's refusal: the caller shows the SDK's message
    return undefined;
  }
};

/**
 * The reply bubbles of one turn, one per model request. A bubble opens on the first text,
 * so none is left empty, and closes at a tool call, so later text lands below the tool's items.
 */
const createReplies = () => {
  let open: { id: string; last: "text" | "reasoning" } | null = null;
  let wrote = false;

  return {
    get wrote() {
      return wrote;
    },
    write(kind: "text" | "reasoning", delta: string) {
      if (!delta) return;
      if (!open) {
        open = { id: PgAssistant.startAssistantMessage(), last: kind };
      } else if (open.last !== kind) {
        // Progress notes and the reply are separate blocks: keep them separate paragraphs
        PgAssistant.appendToAssistantMessage(open.id, "\n\n");
        open.last = kind;
      }
      PgAssistant.appendToAssistantMessage(open.id, delta);
      wrote = true;
    },
    close() {
      open = null;
    },
  };
};

/**
 * One conversation with any backend, on `runTurn`. The history keeps the SDK's messages, so
 * tool calls and Gemini's thought signatures go back as sent; a failed turn leaves it unchanged.
 */
export const createProvider = (
  connection: ProviderConnection,
  /** Prior turns, text only, when reopening a stored thread (`toReplayMessages`) */
  seed: readonly ReplayMessage[] = []
): Provider => {
  const backend = backendFor(connection);
  let history: ModelMessage[] = seed.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  let model: LanguageModel | undefined;

  return {
    id: connection.id,
    label: backend.label,

    async send(input, signal) {
      const ai = await loadAi();
      signal?.throwIfAborted();
      model ??= ai.createModel(backend.connection);

      const replies = createReplies();
      let calledTool = false;

      let result;
      try {
        result = await ai.runTurn({
          model,
          messages: [...history, { role: "user", content: input }],
          instructions: [
            {
              role: "system",
              content: systemPrompt(),
              providerOptions: backend.promptOptions,
            },
            {
              role: "system",
              content: `Current project state:\n\n${describeProject()}`,
            },
          ],
          // Built per turn, so MCP tools discovered since the last one are offered
          tools: ai.toSdkTools(createTools()),
          providerOptions: backend.providerOptions,
          maxOutputTokens: backend.maxOutputTokens,
          signal,
          apiKey: connection.apiKey,
          onText: (delta) => replies.write("text", delta),
          onReasoning: backend.showsReasoning
            ? (delta) => replies.write("reasoning", delta)
            : undefined,
          onToolCall: () => {
            calledTool = true;
            replies.close();
          },
        });
      } catch (e) {
        if (!(e instanceof ai.AiTurnError)) throw e;
        if (e.kind === "refusal") {
          throw new Error(`${e.message} Rephrase it, or switch backends.`);
        }
        const refusal = signedOutRefusal(connection.id, e);
        if (!refusal) throw e;
        // The session ended server-side; ending it here makes the next send open Connect a model, which offers sign-in
        void PgSession.refresh();
        throw new Error(refusal);
      }

      history = result.messages;
      if (result.reachedStepLimit) {
        throw new Error(
          `The model was still calling tools after ${ai.DEFAULT_MAX_STEPS} rounds. Stopped it.`
        );
      }
      // A turn that did its work and had nothing to add ends quietly: a retry would rerun the tools
      if (!replies.wrote && !calledTool) {
        PgAssistant.addError(
          `${backend.label} returned an empty response. Try again, or pick another model.`
        );
      }
    },
  };
};
