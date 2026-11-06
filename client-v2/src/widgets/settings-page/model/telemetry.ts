import type {
  SettingsEntry,
  SettingsExit,
} from "@/shared/lib/settings-request";
import type { NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";

type SettingsEvents = {
  /** The settings page opened; `from` is the control or key that opened it. */
  settings_opened: { from: SettingsEntry };
  /** The settings page closed, by "Back to app", Escape or ⌘, (`key`). */
  settings_closed: { via: SettingsExit };
  /** A user picked a section in the page's section list. */
  settings_section_picked: { section: string };
  /** A user pressed Delete my key in the Assistant section: the key and the backend are dropped. Never the key or the provider. */
  settings_key_deleted: NoParams;
  /**
   * A custom RPC was saved in Settings, Network: a new one (`add`) or an
   * edited one (`edit`). `check`: its URL answered (`passed`), it was saved
   * through "Use anyway" (`used_anyway`), or no request was needed (`none`,
   * an edit that kept its URL).
   */
  settings_custom_rpc_saved: {
    mode: "add" | "edit";
    check: "passed" | "used_anyway" | "none";
  };
  /** A saved custom RPC was removed; `picked` says whether it was the network in use. */
  settings_custom_rpc_removed: { picked: boolean };
  /**
   * Saving a custom RPC was refused: the URL fails the rule (`format`), it is
   * saved or offered already (`duplicate`), the browser refused the write
   * (`storage`), the URL did not answer its health check (`no_answer`), or
   * the browser was offline so no check ran (`offline`). The last two still
   * offer "Use anyway".
   */
  settings_custom_rpc_refused: {
    reason: "format" | "duplicate" | "storage" | "no_answer" | "offline";
  };
};

export const settingsTelemetry = createTracker<SettingsEvents>();
