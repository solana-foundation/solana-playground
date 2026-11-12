import { createTracker } from "@/shared/lib/telemetry";

/** Where Delete my key was pressed: the assistant head's More, or the Assistant section of Settings */
export type KeyDeletedVia = "assistant" | "settings";

type AssistantKeyEvents = {
  /** The user pressed Delete my key: the key and the backend are dropped. `via` says where: the assistant head's More (`assistant`) or the Assistant section of Settings (`settings`). Never the key or the provider. */
  assistant_key_deleted: { via: KeyDeletedVia };
};

/**
 * The tracker of the key `PgAssistant` holds, declared beside the store
 * because two widgets send its event: `widgets/assistant` owns the
 * `assistant` prefix, and `widgets/settings-page` may not import another
 * widget, while both import this store already.
 */
export const assistantKeyTelemetry = createTracker<AssistantKeyEvents>();
