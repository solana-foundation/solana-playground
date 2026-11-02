import playgroundEnvSkill from "../content/playground-env.skill.md";
import { SKILL_CATALOGUE } from "@/entities/agent-tools";
import type { SkillEntry } from "./types";
import type { SkillDeclaration } from "@/entities/agent-tools";

/**
 * The text of each bundled skill, by id. The catalogue lives in
 * `entities/agent-tools` so server code can read it as well, but Node cannot
 * import markdown, so the bundle binds the content here.
 */
const BUNDLED_CONTENT: Record<string, string> = {
  "playground-env": playgroundEnvSkill,
};

/**
 * Attach each bundled skill's content to its catalogue entry.
 *
 * @throws when a bundled skill has no content, so the panel fails at load
 *   rather than when the model first asks for the skill
 */
const withContent = (
  catalogue: readonly SkillDeclaration[],
  contents: Record<string, string>
): SkillEntry[] =>
  catalogue.map(({ id, name, description, source }) => {
    if (source.type === "remote") return { id, name, description, source };
    const content = contents[id];
    if (content === undefined) {
      throw new Error(`The bundled skill "${id}" has no content bound to it.`);
    }
    return { id, name, description, source: { type: "bundled", content } };
  });

/**
 * The skills the panel offers: the shared catalogue, with bundled content.
 *
 * Adding one is an entry in `entities/agent-tools` (plus its content above if
 * it ships in the bundle) — the tools, the prompt catalogue and the picker all
 * read this list.
 */
export const SKILLS: SkillEntry[] = withContent(
  SKILL_CATALOGUE,
  BUNDLED_CONTENT
);

/** Skills that are on unless the user turns them off */
export const DEFAULT_SKILL_IDS = SKILLS.map((skill) => skill.id);

export const findSkill = (id: string) => SKILLS.find((s) => s.id === id);

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/sidebar/assistant/grounding/registry", () => {
    it("offers the shared catalogue, in order, with names unchanged", () => {
      expect(
        SKILLS.map(({ id, name, description }) => ({ id, name, description }))
      ).toEqual(
        SKILL_CATALOGUE.map(({ id, name, description }) => ({
          id,
          name,
          description,
        }))
      );
    });

    it("binds content to every bundled skill and passes remote sources through", () => {
      SKILLS.forEach((skill, index) => {
        if (skill.source.type === "bundled") {
          expect(skill.source.content.trim()).not.toBe("");
        } else {
          expect(skill.source).toBe(SKILL_CATALOGUE[index].source);
        }
      });
    });

    it("refuses a bundled skill with no content", () => {
      const orphan: SkillDeclaration = {
        id: "orphan",
        name: "Orphan",
        description: "Declared as bundled, never bound.",
        source: { type: "bundled" },
      };
      expect(() => withContent([orphan], {})).toThrow(
        /"orphan" has no content/
      );
    });
  });
}
