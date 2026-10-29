import type { JSONValue } from "ai";
import type { AiTurnError, ModelConnection } from "@/shared/lib/ai";
import type { Effort } from "../types";

/** What a model provider's profile reads from the store's `Connection` */
export interface ModelProviderInput {
  apiKey: string;
  /** Base URL and model, for OpenAI-compatible model providers */
  endpoint?: { baseUrl: string; model: string };
  /** Model and effort, for model providers that pick them without a base URL */
  settings?: { model: string; effort: Effort };
}

export type ProviderOptions = Record<string, Record<string, JSONValue>>;

/** Everything that differs between model providers, as data for the one turn loop */
export interface TurnProfile {
  connection: ModelConnection;
  /** Shown in the panel footer and in the empty-response error */
  label: string;
  /** Whether the model's reasoning reaches the reply bubble */
  showsReasoning: boolean;
  providerOptions?: ProviderOptions;
  /** Set on the first system message, which is stable across turns */
  promptOptions?: ProviderOptions;
  maxOutputTokens?: number;
  /** The sentence this model provider refuses a signed-out turn with, or `undefined` for any other failure */
  signedOutRefusal?: (error: AiTurnError) => string | undefined;
}

/** One model provider's turn settings */
export interface ModelProviderProfile {
  profile(input: ModelProviderInput): TurnProfile;
}
