import {
  PROVIDERS,
  type Effort,
} from "../../../views/sidebar/assistant/model/types";
import type { Connection } from "../../../views/sidebar/assistant/store";

/** The model and effort a connection runs with, its provider's defaults when it names none, as `createProvider` does */
const settingsOf = (current: Connection) =>
  current.settings ??
  PROVIDERS.find((p) => p.id === current.id)?.modelSettings?.defaults;

/** The base URL and model a connection runs with, its provider's defaults when it names none */
const endpointOf = (current: Connection) => {
  if (current.endpoint) return current.endpoint;
  const preset = PROVIDERS.find((p) => p.id === current.id)?.endpoint;
  return preset && { baseUrl: preset.baseUrl, model: preset.model };
};

/**
 * The connection switched to another model of its own backend, for
 * `PgAssistant.tune`: same key, same base URL, same effort.
 *
 * @returns `null` when the model is the one already in use, or the backend
 * picks no model of its own (the default backend's is the server's)
 */
export const withModel = (
  current: Connection,
  model: string
): Connection | null => {
  const settings = settingsOf(current);
  if (settings) {
    if (settings.model === model) return null;
    return {
      id: current.id,
      apiKey: current.apiKey,
      settings: { model, effort: settings.effort },
    };
  }
  const endpoint = endpointOf(current);
  if (endpoint) {
    if (endpoint.model === model) return null;
    return {
      id: current.id,
      apiKey: current.apiKey,
      endpoint: { baseUrl: endpoint.baseUrl, model },
    };
  }
  return null;
};

/**
 * The connection with another reasoning effort, for `PgAssistant.tune`.
 *
 * @returns `null` when the effort is unchanged, or the backend takes none
 */
export const withEffort = (
  current: Connection,
  effort: Effort
): Connection | null => {
  const settings = settingsOf(current);
  if (!settings || settings.effort === effort) return null;
  return {
    id: current.id,
    apiKey: current.apiKey,
    settings: { model: settings.model, effort },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/assistant/model/tune", () => {
    const anthropic: Connection = {
      id: "anthropic",
      apiKey: "sk-ant-1",
      settings: { model: "claude-opus-5-5", effort: "high" },
    };

    const gemini: Connection = {
      id: "gemini",
      apiKey: "AIza-1",
      endpoint: {
        baseUrl: "https://proxy.example/v1",
        model: "gemini-3.6-flash",
      },
    };

    describe("withModel", () => {
      it("keeps the key and the effort on a model-settings backend", () => {
        expect(withModel(anthropic, "claude-sonnet-5-5")).toEqual({
          id: "anthropic",
          apiKey: "sk-ant-1",
          settings: { model: "claude-sonnet-5-5", effort: "high" },
        });
      });

      it("keeps the key and the base URL on an endpoint backend", () => {
        expect(withModel(gemini, "gemini-3.1-pro-preview")).toEqual({
          id: "gemini",
          apiKey: "AIza-1",
          endpoint: {
            baseUrl: "https://proxy.example/v1",
            model: "gemini-3.1-pro-preview",
          },
        });
      });

      it("starts from the provider's defaults when the connection names none", () => {
        expect(
          withModel({ id: "anthropic", apiKey: "k" }, "claude-sonnet-5-5")
        ).toEqual({
          id: "anthropic",
          apiKey: "k",
          settings: { model: "claude-sonnet-5-5", effort: "high" },
        });
        expect(
          withModel({ id: "gemini", apiKey: "k" }, "gemini-3.1-pro-preview")
        ).toEqual({
          id: "gemini",
          apiKey: "k",
          endpoint: {
            baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            model: "gemini-3.1-pro-preview",
          },
        });
      });

      it("is null for the model already in use", () => {
        expect(withModel(anthropic, "claude-opus-5-5")).toBeNull();
        expect(withModel(gemini, "gemini-3.6-flash")).toBeNull();
      });

      it("is null for the default backend, whose model is the server's", () => {
        expect(withModel({ id: "default", apiKey: "" }, "anything")).toBeNull();
      });
    });

    describe("withEffort", () => {
      it("keeps the key and the model", () => {
        expect(withEffort(anthropic, "low")).toEqual({
          id: "anthropic",
          apiKey: "sk-ant-1",
          settings: { model: "claude-opus-5-5", effort: "low" },
        });
      });

      it("is null for the effort already in use", () => {
        expect(withEffort(anthropic, "high")).toBeNull();
      });

      it("is null for a backend that takes no effort", () => {
        expect(withEffort(gemini, "low")).toBeNull();
        expect(withEffort({ id: "default", apiKey: "" }, "low")).toBeNull();
      });
    });
  });
}
