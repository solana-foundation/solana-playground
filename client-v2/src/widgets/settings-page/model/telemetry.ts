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
};

export const settingsTelemetry = createTracker<SettingsEvents>();
