import { PROVIDERS } from "../types";
import type { OpenAiCompatibleProvider } from "@/shared/lib/ai";
import type { BackendProfile } from "./types";

/** One profile per OpenAI-compatible provider id; they differ only in their default endpoint */
export const openAiCompatibleBackend = (
  id: OpenAiCompatibleProvider
): BackendProfile => ({
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
