import type { ModelProvider } from "@/shared/lib/ai";

/** The deployment's own backend, which needs a session instead of a key */
export const isDefaultBackend = (id: ModelProvider | undefined) =>
  id === "default";

/**
 * Whether Delete my key can act, wherever it is offered (Settings, the
 * assistant head's More): `none` while no backend holding the user's key is
 * connected, `busy` while a turn is using the key, else `ready`
 */
export type KeyHold = "none" | "ready" | "busy";

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
   * @param turn `signal` aborts the turn, which rejects with the abort reason
   * @throws {TurnFailure} when the backend, the model or the backend's cost
   *   gate ended the turn without an answer; any other rejection is the abort
   *   reason or a failure raised on this side
   */
  send(input: string, turn?: { signal?: AbortSignal }): Promise<void>;
}

/**
 * Why a turn ended without an answer: the backend answered with an error or
 * did not answer (`provider`), the model refused the prompt (`refusal`), the
 * turn kept pausing past the resume limit (`paused`), or the backend refused
 * it under its cost gate (`capped`).
 */
export type TurnFailureReason = "provider" | "refusal" | "paused" | "capped";

/**
 * A turn the provider ended without an answer. `message` is what the thread
 * shows; `reason` and `status` are for telemetry to report, so telemetry
 * reads neither the SDK's error class, which is loaded on demand, nor the
 * message's text. `cause` keeps the SDK's error, with its stack, the redacted
 * response body and its finer `kind`: the widget reads that kind by name to
 * offer a refused key again and to cut off a reply whose stream dropped.
 */
export class TurnFailure extends Error {
  readonly reason: TurnFailureReason;
  /** The HTTP status, when the backend answered with an error status */
  readonly status?: number;

  constructor(
    message: string,
    {
      reason,
      status,
      cause,
    }: { reason: TurnFailureReason; status?: number; cause?: unknown }
  ) {
    super(message, { cause });
    // For a stack trace or a log; `instanceof` is what classifies a failure
    this.name = "TurnFailure";
    this.reason = reason;
    this.status = status;
  }
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
    description: "Runs on this playground, nothing to enter",
    needsKey: false,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Opus or Sonnet, from your browser",
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
    description: "Any chat-completions endpoint or proxy",
    needsKey: true,
    keyOptional: true,
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-… (or empty for a local proxy)",
    endpoint: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.1" },
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Google's models, free tier is enough",
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
    description: "One key for many models, some of them free",
    needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-…",
    endpoint: {
      baseUrl: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-chat-v3.1:free",
    },
  },
];
