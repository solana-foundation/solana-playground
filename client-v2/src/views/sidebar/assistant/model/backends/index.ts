import { anthropicBackend } from "./anthropic";
import { defaultBackend } from "./default";
import { openAiCompatibleBackend } from "./openai-compatible";
import type { ModelProvider } from "@/shared/lib/ai";
import type { BackendProfile } from "./types";

// A `Record` over every id, so a provider id added without a profile fails to compile
export const BACKENDS: Record<ModelProvider, BackendProfile> = {
  default: defaultBackend,
  anthropic: anthropicBackend,
  openai: openAiCompatibleBackend("openai"),
  openrouter: openAiCompatibleBackend("openrouter"),
  gemini: openAiCompatibleBackend("gemini"),
};

export type { BackendInput, BackendProfile, TurnProfile } from "./types";
