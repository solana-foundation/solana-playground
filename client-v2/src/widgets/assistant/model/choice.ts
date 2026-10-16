import {
  PROVIDERS,
  type Effort,
} from "../../../views/sidebar/assistant/model/types";
import type { Connection } from "../../../views/sidebar/assistant/store";
import type { KeyedProviderId } from "./connection";
import type { DefaultBackend } from "./default-backend";
import { displayModelName } from "./model-name";

/** The effort a connection runs at, on the ladder its provider offers */
export interface EffortChoice {
  value: Effort;
  ladder: readonly Effort[];
}

/** What the composer's model button shows */
export type ModelShown =
  /** The deployment's default is still being asked about: nothing to offer yet */
  | { kind: "checking" }
  /** Nothing to send to: the button opens Connect a model */
  | { kind: "none" }
  /** The deployment's default, connected or about to be on the first send */
  | { kind: "default"; label: string; connected: boolean }
  /** A key-based backend */
  | {
      kind: "keyed";
      provider: KeyedProviderId;
      /**
       * The model id the menu checks by; `null` for a provider that names
       * none of its own (none does today)
       */
      model: string | null;
      label: string;
      /** `null` when the provider has no ladder, or its ladder lacks the value */
      effort: EffortChoice | null;
    };

/** One entry of the model menu */
export type ModelOption =
  /** The deployment's default: the server picks its model */
  | { provider: "default"; model: null; label: string }
  /** A model of a key-based backend, by id */
  | { provider: KeyedProviderId; model: string; label: string };

/** `value` on `ladder`, or `null` when the ladder has no place for it */
const effortOn = (
  value: Effort,
  ladder: readonly Effort[] | undefined
): EffortChoice | null => (ladder?.includes(value) ? { value, ladder } : null);

const DEFAULT_LABEL = "Default model";

const defaultLabel = (backend: DefaultBackend) => {
  if (backend.state === "present" && backend.model !== null) {
    return displayModelName(backend.model);
  }
  return DEFAULT_LABEL;
};

/** What the model button shows for the current connection, or for the default about to be used */
export const modelShown = (
  connection: Connection | null,
  defaultBackend: DefaultBackend
): ModelShown => {
  if (connection === null) {
    if (defaultBackend.state === "checking") return { kind: "checking" };
    if (defaultBackend.state !== "present") return { kind: "none" };
    return {
      kind: "default",
      label: defaultLabel(defaultBackend),
      connected: false,
    };
  }
  if (connection.id === "default") {
    return {
      kind: "default",
      label: defaultLabel(defaultBackend),
      connected: true,
    };
  }
  // A connection with no model of its own gets the provider's default, as
  // `createProvider` does
  const info = PROVIDERS.find((p) => p.id === connection.id);
  const settings = connection.settings ?? info?.modelSettings?.defaults;
  if (settings) {
    return {
      kind: "keyed",
      provider: connection.id,
      model: settings.model,
      label: displayModelName(settings.model),
      effort: effortOn(settings.effort, info?.modelSettings?.efforts),
    };
  }
  const endpoint = connection.endpoint ?? info?.endpoint;
  return {
    kind: "keyed",
    provider: connection.id,
    model: endpoint?.model ?? null,
    label: endpoint ? displayModelName(endpoint.model) : DEFAULT_LABEL,
    effort: null,
  };
};

/** The model menu: the deployment's default first, then each provider's listed models */
export const modelOptions = (defaultBackend: DefaultBackend): ModelOption[] => {
  const options: ModelOption[] = [];
  if (defaultBackend.state === "present") {
    options.push({
      provider: "default",
      model: null,
      label: defaultLabel(defaultBackend),
    });
  }
  for (const info of PROVIDERS) {
    const provider = info.id;
    if (provider === "default") continue;
    const models = [
      ...(info.modelSettings?.models ?? []),
      ...(info.endpoint?.models ?? []),
    ];
    for (const model of models) {
      options.push({
        provider,
        model,
        label: displayModelName(model),
      });
    }
  }
  return options;
};
