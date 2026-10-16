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
