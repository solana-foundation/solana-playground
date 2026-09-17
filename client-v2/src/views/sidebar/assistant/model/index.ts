import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";
import { DEFAULT_BACKEND_URL, PROVIDERS } from "./types";
import type { ReplayMessage } from "../../../../features/persistence/model/replay";
import type { Effort, Provider, ProviderId } from "./types";

export * from "./types";

/** What a provider needs to be built — structurally the store's `Connection` */
export interface ProviderConnection {
  id: ProviderId;
  apiKey: string;
  /** Base URL and model, for OpenAI-compatible backends */
  endpoint?: { baseUrl: string; model: string };
  /** Model and effort, for backends that pick them without a base URL */
  settings?: { model: string; effort: Effort };
}

/**
 * Build the provider for a conversation.
 *
 * @param connection which backend, and what it needs to be reached
 * @returns a provider that owns its own history
 */
export const createProvider = (
  { id, apiKey, endpoint, settings }: ProviderConnection,
  /** Prior turns, when reopening a stored thread. Empty for a new one. */
  seed: readonly ReplayMessage[] = []
): Provider => {
  switch (id) {
    // The model is the server's to pick, so none is sent and none is shown
    case "default":
      return createOpenAiProvider(
        {
          id,
          url: DEFAULT_BACKEND_URL,
          baseUrl: "",
          model: "",
          apiKey: "",
          label: "default backend",
        },
        seed
      );
    case "anthropic":
      return createAnthropicProvider(apiKey, settings, seed);
    case "openai":
    case "openrouter":
    case "gemini": {
      const defaults = PROVIDERS.find((p) => p.id === id)!.endpoint!;
      return createOpenAiProvider(
        { id, apiKey, ...(endpoint ?? defaults) },
        seed
      );
    }
  }
};
