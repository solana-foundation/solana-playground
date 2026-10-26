import { PROVIDERS } from "../types";
import type { OpenAiCompatibleProvider } from "@/shared/lib/ai";
import type { ModelProviderProfile } from "./types";

/** One profile per OpenAI-compatible provider id; they differ only in their default endpoint */
export const openAiCompatibleProfile = (
  id: OpenAiCompatibleProvider
): ModelProviderProfile => ({
  profile: ({ apiKey, endpoint }) => {
    const { baseUrl, model } =
      endpoint ?? PROVIDERS.find((p) => p.id === id)!.endpoint!;
    return {
      connection: { provider: id, apiKey, baseUrl, model },
      label: model,
      showsReasoning: false,
    };
  },
});
