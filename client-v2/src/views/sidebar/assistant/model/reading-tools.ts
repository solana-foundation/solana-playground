/**
 * The assistant's tools that only read: the project's files, the last build
 * error, and the skills' guidance. A mode that must not write or run offers
 * these (`AssistantMode.allows`); `tools.test.ts` checks every name against
 * the real tools, so renaming one of them fails that test until this list
 * follows.
 */
export const READING_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "get_build_error",
  "list_skills",
  "load_skill",
  "read_skill_reference",
]);
