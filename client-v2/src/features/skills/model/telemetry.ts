import { createTracker } from "@/shared/lib/telemetry";

type SkillsEvents = {
  /**
   * The user checked or unchecked a skill in the Sources tab: `id` is the
   * skill's id as the catalogue names it, `enabled` the state it moved to
   */
  skills_toggled: { id: string; enabled: boolean };
};

export const skillsTelemetry = createTracker<SkillsEvents>();
