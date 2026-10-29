import type { ModelProvider } from "@/shared/lib/ai";
import type { Connection } from "../store";
import { PROVIDERS } from "./types";
import type { Effort } from "./types";

/**
 * Which backend a thread was created with, or a reply produced by.
 *
 * Never the API key, in any form -- not the value, not a hash, not the last
 * four characters. A thread is synced to the account; the key never is.
 */
export interface BackendParams {
  provider: ModelProvider;
  /** Absent only on a backend that picks its own model server-side */
  model?: string;
  /** Only the OpenAI-compatible providers have one */
  baseUrl?: string;
  effort?: Effort;
}

/** The parameters a connection is identified by, with the key left behind */
export const paramsOf = (
  connection: Connection | null
): BackendParams | undefined => {
  if (!connection) return undefined;

  const params: BackendParams = { provider: connection.id };
  const model = connection.endpoint?.model ?? connection.settings?.model;
  if (model) params.model = model;
  if (connection.endpoint?.baseUrl)
    params.baseUrl = connection.endpoint.baseUrl;
  if (connection.settings?.effort) params.effort = connection.settings.effort;
  return params;
};

/**
 * Backend parameters read from anywhere they may have been written by another
 * build, or by hand: a stored thread, the account's copy of it, the remembered
 * choice. Rebuilt field by field so nothing unknown rides along; a provider
 * this build does not have reads as `null`, since Connect a model cannot open
 * on it, and an effort the provider does not offer is left out.
 */
export const backendParamsFrom = (value: unknown): BackendParams | null => {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;

  const provider = PROVIDERS.find((p) => p.id === stored.provider);
  if (!provider) return null;
  const params: BackendParams = { provider: provider.id };
  if (typeof stored.model === "string") params.model = stored.model;
  if (typeof stored.baseUrl === "string") params.baseUrl = stored.baseUrl;
  const effort = provider.modelSettings?.efforts.find(
    (e) => e === stored.effort
  );
  if (effort) params.effort = effort;
  return params;
};
