import type { ModelProvider } from "@/shared/lib/ai";

/** The deployment's own backend, which needs a session instead of a key */
export const isDefaultBackend = (id: ModelProvider | undefined) =>
  id === "default";

/**
 * One conversation with one backend.
 *
 * A provider owns its own message history and streams text into the store as it
 * arrives, so the UI does not need to know anything about the wire format.
 */
export interface Provider {
  readonly id: ModelProvider;
  /** Shown in the panel footer */
  readonly label: string;
  /**
   * Take one turn.
   *
   * @param input what the user typed
   * @param signal aborts the turn; rejects with the abort reason
   * @param context what goes with this message; everything when absent. A
   * provider must pass it to `describeProject`: `openFile: false` is the user
   * leaving that file's content out, and sending it anyway breaks that
   */
  send(
    input: string,
    signal?: AbortSignal,
    context?: TurnContext
  ): Promise<void>;
}

/** What the user chose to send with one message */
export interface TurnContext {
  /** `false` when the user left the open file's content out of it */
  openFile: boolean;
}

/** Reasoning depth, and the main cost lever on the Anthropic backend */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Model and effort offered on the connect screen, for a backend that has no
 * base URL to configure. `endpoint` covers the OpenAI-compatible ones.
 */
export interface ModelSettings {
  models: readonly string[];
  efforts: readonly Effort[];
  defaults: { model: string; effort: Effort };
}

/** How a provider is described on the connect screen */
export interface ProviderInfo {
  id: ModelProvider;
  name: string;
  /** One line on what picking this gets you */
  description: string;
  /** Whether the user has to supply a key */
  needsKey: boolean;
  /** Where to get a key, when one is needed */
  keyUrl?: string;
  /** Placeholder for the key field */
  keyPlaceholder?: string;
  /** The key field may be left empty (e.g. a local proxy that checks none) */
  keyOptional?: boolean;
  /**
   * OpenAI-compatible endpoint settings, editable on the connect screen.
   * Present only on the OpenAI-compatible providers.
   * `models` offers known-good ids as one-click presets; the field stays free
   * text, since any id the endpoint serves is valid.
   */
  endpoint?: {
    baseUrl: string;
    model: string;
    models?: readonly string[];
  };
  /** Model and effort pickers, for backends without a base URL */
  modelSettings?: ModelSettings;
  /** Declared but not implemented yet — shown, but cannot be selected */
  unavailable?: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "default",
    name: "Default",
    description:
      "The agentic backend this playground is deployed with — what you talk " +
      "to unless you pick something else. Its model and key live server-side, " +
      "so there is nothing to enter.",
    needsKey: false,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description:
      "Claude with adaptive thinking, called straight from the browser. " +
      "Sonnet costs half of Opus per token; effort is the other cost lever.",
    needsKey: true,
    keyUrl: "https://console.anthropic.com/",
    keyPlaceholder: "sk-ant-…",
    modelSettings: {
      // Both take adaptive thinking and the full effort ladder. Haiku 4.5
      // takes neither, so offering it would need a different request shape.
      models: ["claude-opus-5-5", "claude-sonnet-5-5"],
      efforts: ["low", "medium", "high", "xhigh", "max"],
      // High, as the prototype's Connect a model picker shows it; Medium
      // stays a pick for a cheaper turn
      defaults: { model: "claude-opus-5-5", effort: "high" },
    },
  },
  {
    id: "openai",
    name: "OpenAI-compatible",
    description:
      "Any endpoint that speaks the chat-completions protocol: OpenAI itself, " +
      "a local proxy, LiteLLM. Point it at your base URL and model.",
    needsKey: true,
    keyOptional: true,
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-… (or empty for a local proxy)",
    endpoint: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.1" },
  },
  {
    id: "gemini",
    name: "Gemini",
    description:
      "Google's models through their OpenAI-compatible endpoint — the AI " +
      "Studio free tier is enough for a full walkthrough.",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    endpoint: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      // 2.5-flash is deprecated: 404s for new keys, migration target is 3.6
      model: "gemini-3.6-flash",
      // Pro reasons harder about build errors but is the first to 503 on the
      // free tier; a preview id, so expect it to be renamed
      models: ["gemini-3.6-flash", "gemini-3.1-pro-preview"],
    },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description:
      "One key for many models, including free ones — pick any model id " +
      "that supports tool calling.",
    needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-…",
    endpoint: {
      baseUrl: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-chat-v3.1:free",
    },
  },
];
