import { createTracker } from "@/shared/lib/telemetry";
import type {
  SettingsEntry,
  SettingsExit,
} from "@/shared/lib/settings-request";

type SettingsEvents = {
  /** The settings page opened; `from` is the control or key that opened it. */
  settings_opened: { from: SettingsEntry };
  /** The settings page closed, by "Back to app", Escape or ⌘, (`key`). */
  settings_closed: { via: SettingsExit };
  /** A user picked a section in the page's section list. */
  settings_section_picked: { section: string };
};

export const settingsTelemetry = createTracker<SettingsEvents>();
