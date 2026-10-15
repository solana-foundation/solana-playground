import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import { DEFAULT_BACKEND_URL } from "./default-backend";
import type { ModelConnection } from "./types";

/**
 * Build the SDK model for a connection.
 *
 * The default backend posts every request to {@link DEFAULT_BACKEND_URL} with
 * no key; Anthropic gets the header that lets a browser call it directly.
 *
 * @example Anthropic from the browser
 * ```ts
 * const model = createModel({ provider: "anthropic", apiKey, model: "claude-opus-5-5" });
 * ```
 */
export const createModel = (connection: ModelConnection): LanguageModel => {
  switch (connection.provider) {
    case "default": {
      const { fetch: send } = connection;
      return createOpenAICompatible({
        name: "default",
        // The SDK parses the base URL with `new URL`, which rejects a relative one
        baseURL: new URL(DEFAULT_BACKEND_URL, globalThis.location.href).href,
        // The SDK appends `/chat/completions`; `/api/agent` is already the full path
        fetch: (_url, init) =>
          (send ?? globalThis.fetch)(DEFAULT_BACKEND_URL, init),
      })(connection.model ?? "");
    }
    case "anthropic":
      return createAnthropic({
        apiKey: connection.apiKey,
        baseURL: connection.baseUrl,
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
        fetch: connection.fetch,
      })(connection.model);
    case "openai":
    case "openrouter":
    case "gemini":
      return createOpenAICompatible({
        name: connection.provider,
        baseURL: connection.baseUrl,
        apiKey: connection.apiKey || undefined,
        fetch: connection.fetch,
      })(connection.model);
  }
};
