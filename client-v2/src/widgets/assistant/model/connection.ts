import type { ModelProvider } from "@/shared/lib/ai";
import type { Connection } from "../../../views/sidebar/assistant/store";

/** The deployment's keyless default, as `PgAssistant.connect` takes it */
export const DEFAULT_CONNECTION: Connection = { id: "default", apiKey: "" };

/** A backend that runs on the user's own key: every one but the default */
export type KeyedProviderId = Exclude<ModelProvider, "default">;

/**
 * Connect's entry in the head's More and the composer's +: it sets a model up
 * with nothing connected, and changes the connection or its key once one is
 */
export const connectLabel = (connection: Connection | null) =>
  connection ? "Connection and key…" : "Connect a model…";
