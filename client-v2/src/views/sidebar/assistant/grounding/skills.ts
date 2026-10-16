import { findSkill, SKILLS } from "./registry";
import type { SkillEntry } from "./types";

/** A skill file bigger than this is truncated rather than flooding the turn */
const MAX_CHARS = 120_000;

/** Fetched files, keyed by resolved URL — a skill is re-read every turn */
const cache = new Map<string, string>();

/**
 * Resolve a reference path against a skill's base URL.
 *
 * The path comes out of a `SKILL.md` we do not control, so it is confined to
 * the skill's own folder: no `..`, no absolute path, no other origin.
 *
 * @throws if the path escapes the skill's base URL
 */
const resolveReference = (baseUrl: string, path: string) => {
  const url = new URL(path, baseUrl);
  if (!url.href.startsWith(baseUrl)) {
    throw new Error(
      `"${path}" is outside this skill's files. Reference paths must be ` +
        `relative to the skill folder.`
    );
  }
  return url.href;
};

/** Fetch and cache one file, or throw with something the model can act on */
const fetchText = async (url: string) => {
  const cached = cache.get(url);
  if (cached !== undefined) return cached;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not reach ${url}: ${message}`);
  }

  if (!response.ok) {
    throw new Error(
      `${url} returned ${response.status} ${response.statusText}`
    );
  }

  const text = await response.text();
  const capped =
    text.length > MAX_CHARS
      ? `${text.slice(0, MAX_CHARS)}\n\n[truncated: file is ${
          text.length
        } characters]`
      : text;

  cache.set(url, capped);
  return capped;
};

/** Skills the user has enabled, in registry order */
export const enabledSkills = (enabledIds: readonly string[]) =>
  SKILLS.filter((skill) => enabledIds.includes(skill.id));

/**
 * The catalogue that goes in the system prompt — names and descriptions only,
 * never bodies, so the cached prompt prefix stays byte-stable.
 */
export const describeCatalog = (enabledIds: readonly string[]) => {
  const skills = enabledSkills(enabledIds);
  if (!skills.length) return "No skills are enabled.";
  return skills
    .map((skill) => `- ${skill.id} (${skill.name}): ${skill.description}`)
    .join("\n");
};

/**
 * Read a skill's entry document.
 *
 * @param skill which skill
 * @returns the skill's `SKILL.md`, whose own text names its reference files
 */
export const loadSkill = async (skill: SkillEntry) => {
  if (skill.source.type === "bundled") return skill.source.content;
  return fetchText(skill.source.baseUrl + skill.source.entry);
};

/**
 * Read one of a skill's reference files.
 *
 * @param skill which skill
 * @param path path relative to the skill folder, e.g. `references/security.md`
 */
export const loadReference = async (skill: SkillEntry, path: string) => {
  if (skill.source.type === "bundled") {
    throw new Error(
      `${skill.id} is a single document with no reference files — ` +
        `load_skill returns all of it.`
    );
  }
  return fetchText(resolveReference(skill.source.baseUrl, path));
};

/** Look a skill up by the id the model supplied */
export const requireSkill = (id: string) => {
  const skill = findSkill(id);
  if (!skill) {
    throw new Error(
      `There is no skill with id "${id}". Call list_skills to see what exists.`
    );
  }
  return skill;
};
