import type { JSONValue } from "ai";
import type { AgentRefusalReason, AgentTierParam } from "@/features/agent";
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

/** A refusal by our own backend that the panel answers in a sentence of its own */
export type BackendRefusal =
  | { kind: "signed-out"; message: string }
  | {
      kind: "limit";
      reason: AgentRefusalReason;
      tier: AgentTierParam;
      message: string;
    };

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
  /** Which of our backend's refusals a failed turn is, or `undefined` for any other failure */
  backendRefusal?: (error: AiTurnError) => BackendRefusal | undefined;
  /**
   * A refusal this backend wrote for people, shown as it is, or `undefined`
   * for a failure that gets Spec 08's words (`AiTurnError.message`)
   */
  ownRefusal?: (error: AiTurnError) => string | undefined;
  /**
   * For a backend we run, whether a 502, 503, 504 or 529 (`isOutage`) is its
   * own fault and ours to hear of; `runTurn` reports no outage, a third
   * party's being on its own status page
   */
  reportsOutage?: (error: AiTurnError) => boolean;
}

/** One model provider's turn settings */
export interface ModelProviderProfile {
  profile(input: ModelProviderInput): TurnProfile;
}
