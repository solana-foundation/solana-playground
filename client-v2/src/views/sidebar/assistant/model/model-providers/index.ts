import { anthropicProfile } from "./anthropic";
import { defaultProfile } from "./default";
import { openAiCompatibleProfile } from "./openai-compatible";
import type { ModelProvider } from "@/shared/lib/ai";
import type { ModelProviderProfile } from "./types";

// A `Record` over every id, so a provider id added without a profile fails to compile
export const MODEL_PROVIDER_PROFILES: Record<
  ModelProvider,
  ModelProviderProfile
> = {
  default: defaultProfile,
  anthropic: anthropicProfile,
  openai: openAiCompatibleProfile("openai"),
  openrouter: openAiCompatibleProfile("openrouter"),
  gemini: openAiCompatibleProfile("gemini"),
};

export type {
  ModelProviderInput,
  ModelProviderProfile,
  TurnProfile,
} from "./types";
