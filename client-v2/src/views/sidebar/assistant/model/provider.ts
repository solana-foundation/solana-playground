import { loadAi } from "@/shared/lib/ai";
import { createTools } from "./tools";
import { describeProject, systemPrompt } from "./prompt";
import { PgAssistant } from "../store";
import { MAX_RESUMES, MAX_STEPS } from "../config";
import { PgSession } from "../../../../features/auth";
import { MODEL_PROVIDER_PROFILES } from "./model-providers";
import { ModelBusyError } from "./model-busy";
import type { LanguageModel, ModelMessage } from "ai";
import type { ModelProvider } from "@/shared/lib/ai";
import type { ReplayMessage } from "../../../../features/persistence/model/replay";
import type { ModelProviderInput } from "./model-providers";
import type { Provider } from "./types";

/** What a provider needs to be built: structurally the store's `Connection` */
export interface ProviderConnection extends ModelProviderInput {
  id: ModelProvider;
}

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
 * One conversation with any model provider, on `runTurn`. The history keeps the SDK's messages, so
 * tool calls and Gemini's thought signatures go back as sent; a failed turn leaves it unchanged.
 */
export const createProvider = (
  connection: ProviderConnection,
  /** Prior turns, text only, when reopening a stored thread (`toReplayMessages`) */
  seed: readonly ReplayMessage[] = []
): Provider => {
  const profile = MODEL_PROVIDER_PROFILES[connection.id].profile(connection);
  let history: ModelMessage[] = seed.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  let model: LanguageModel | undefined;

  return {
    id: connection.id,
    label: profile.label,

    async send(input, signal) {
      const ai = await loadAi();
      signal?.throwIfAborted();
      model ??= ai.createModel(profile.connection);

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
              providerOptions: profile.promptOptions,
            },
            {
              role: "system",
              content: `Current project state:\n\n${describeProject()}`,
            },
          ],
          // Built per turn, so MCP tools discovered since the last one are offered
          tools: ai.toSdkTools(createTools()),
          providerOptions: profile.providerOptions,
          maxOutputTokens: profile.maxOutputTokens,
          signal,
          maxSteps: MAX_STEPS,
          maxResumes: MAX_RESUMES,
          apiKey: connection.apiKey,
          onText: (delta) => replies.write("text", delta),
          onReasoning: profile.showsReasoning
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
        // Busy is sent again only before any tool ran: `history` keeps none of this turn, so a retry would run its tools twice
        if (e.kind === "busy" && calledTool) {
          throw new Error(
            `${e.message} What it already ran stays done; send your next message once it is free.`,
            { cause: e }
          );
        }
        if (e.kind === "busy") {
          throw new ModelBusyError(e.retryAfter, e.message, { cause: e });
        }
        const own = profile.ownRefusal?.(e);
        if (own) throw new Error(own, { cause: e });
        const refusal = profile.signedOutRefusal?.(e);
        // Spec 08's words, never the status or the server's text
        if (!refusal) throw e;
        // The session ended server-side; ending it here makes the next send open Connect a model, which offers sign-in
        void PgSession.refresh();
        throw new Error(refusal);
      }

      history = result.messages;
      if (result.reachedStepLimit) {
        throw new Error(
          `The model was still calling tools after ${MAX_STEPS} rounds. Stopped it.`
        );
      }
      // A turn that did its work and had nothing to add ends quietly: a retry would rerun the tools
      if (!replies.wrote && !calledTool) {
        PgAssistant.addError(
          `${profile.label} returned an empty response. Try again, or pick another model.`
        );
      }
    },
  };
};
