import type { ProviderId } from "../../../views/sidebar/assistant/model/types";
import type { Connection } from "../../../views/sidebar/assistant/store";

/** The deployment's keyless default, as `PgAssistant.connect` takes it */
export const DEFAULT_CONNECTION: Connection = { id: "default", apiKey: "" };

/** A backend that runs on the user's own key: every one but the default */
export type KeyedProviderId = Exclude<ProviderId, "default">;
