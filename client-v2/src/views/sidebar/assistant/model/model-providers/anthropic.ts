import { ANTHROPIC_MAX_OUTPUT_TOKENS } from "../../config";
import { PROVIDERS } from "../types";
import type { ModelProviderProfile } from "./types";

/**
 * Anthropic drops thinking blocks whose prefix changed (the project snapshot
 * moves between turns); `updates` returns the progress notes.
 */
export const anthropicProfile: ModelProviderProfile = {
  profile: ({ apiKey, settings }) => {
    const { model, effort } =
      settings ??
      PROVIDERS.find((p) => p.id === "anthropic")!.modelSettings!.defaults;
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
      maxOutputTokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
    };
  },
};
