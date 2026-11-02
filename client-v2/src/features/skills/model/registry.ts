import playgroundEnvSkill from "../../../views/sidebar/assistant/content/playground-env.skill.md";
import type { SkillEntry } from "./types";

/**
 * The text of each skill the bundle ships, by id. The catalogue decides which
 * of them a deployment offers; it cannot change their text.
 */
export const BUNDLED_SKILLS: Readonly<Record<string, string>> = {
  "playground-env": playgroundEnvSkill,
};

/** A bundled skill ships with the app and cannot be switched off: the prompt always lists it */
export const isAlwaysOn = (skill: SkillEntry) =>
  skill.source.type === "bundled";

/** A skill a third party publishes, listed on solana.com/skills */
export const isCommunity = (
  skill: SkillEntry
): skill is SkillEntry & Required<Pick<SkillEntry, "community">> =>
  skill.community !== undefined;
