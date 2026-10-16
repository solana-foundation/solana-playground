import { PgAssistant } from "../store";
import {
  describeCatalog,
  loadReference,
  loadSkill,
  requireSkill,
} from "../grounding";
import type { ToolDefinition, ToolInput } from "./types";

/** Read a required string argument the model supplied */
const str = (input: ToolInput, key: string) => {
  const value = input[key];
  return typeof value === "string" ? value : "";
};

/** Turn a thrown fetch or lookup failure into something the model can act on */
const explain = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Ecosystem knowledge, loaded on demand.
 *
 * Progressive disclosure: only the catalogue sits in the prompt, and a skill's
 * body arrives as a tool result when the model decides it needs it. All three
 * are reads, so none of them asks the user for anything.
 *
 * @returns vendor-neutral tool definitions, so every provider gets them
 */
export const createSkillTools = (): ToolDefinition[] => [
  {
    name: "list_skills",
    description:
      "List the enabled skills with what each covers. Returns the same " +
      "catalogue the system prompt already lists, so there is no need to " +
      "call it before load_skill.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: () => {
      PgAssistant.addToolCall("listed the skills");
      return describeCatalog(PgAssistant.enabledSkillIds);
    },
  },

  {
    name: "load_skill",
    description:
      "Read a skill's main document. The document names its own reference " +
      "files; read those with read_skill_reference rather than guessing at " +
      "their contents. Returns an error string if the id is unknown or the " +
      "fetch fails.",
    schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Skill id from list_skills, e.g. playground-env",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (input) => {
      const id = str(input, "id");
      try {
        const skill = requireSkill(id);
        PgAssistant.addToolCall(`loaded the ${skill.name} skill`);
        return await loadSkill(skill);
      } catch (e) {
        return `Could not load ${id}: ${explain(e)}`;
      }
    },
  },

  {
    name: "read_skill_reference",
    description:
      "Read one reference file belonging to a skill, using a path the " +
      "skill's own document gave you. Paths are relative to the skill " +
      "folder, e.g. references/common-errors.md; a path outside that " +
      "folder is rejected. Bundled skills such as playground-env have no " +
      "reference files. Very large files come back truncated with a marker.",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Skill id, e.g. solana-dev" },
        path: {
          type: "string",
          description:
            "Path relative to the skill folder, e.g. references/security.md",
        },
      },
      required: ["id", "path"],
      additionalProperties: false,
    },
    run: async (input) => {
      const id = str(input, "id");
      const path = str(input, "path");
      try {
        const skill = requireSkill(id);
        PgAssistant.addToolCall(`read ${skill.id}/${path}`);
        return await loadReference(skill, path);
      } catch (e) {
        return `Could not read ${path} from ${id}: ${explain(e)}`;
      }
    },
  },
];
