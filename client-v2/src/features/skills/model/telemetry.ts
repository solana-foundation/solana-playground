import { createTracker } from "@/shared/lib/telemetry";

type SkillsEvents = {
  /**
   * The user checked or unchecked a skill in the Sources tab: `id` is the
   * skill's id as the catalogue names it, `enabled` the state it moved to
   */
  skills_toggled: { id: string; enabled: boolean };
};

/**
 * Free text, opted in: no type lists the values, so the owner decides
 * whether to keep it (HOO-2752)
 */
type SkillsFreeText = {
  id: "a skill id from the list `/api/skills` returns, which the server owns";
};

export const skillsTelemetry = createTracker<SkillsEvents, SkillsFreeText>();
