import type { ToolDefinition, ToolInput } from "@/shared/lib/ai";

import {
  describeCatalog,
  loadReference,
  loadSkill,
  requireSkill,
} from "../grounding";
import { bindTool } from "@/entities/agent-tools";
import type { ToolDefinition, ToolInput } from "@/shared/lib/ai";

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
  bindTool("list_skills", () => {
    PgAssistant.addToolCall("listed the skills");
    return describeCatalog(PgAssistant.enabledSkills);
  }),

  bindTool("load_skill", async (input) => {
    const id = str(input, "id");
    try {
      const skill = requireSkill(
        id,
        PgAssistant.skills,
        PgAssistant.enabledSkillIds
      );
      PgAssistant.addToolCall(`loaded ${skill.name}`);
      return await loadSkill(skill);
    } catch (e) {
      return `Could not load ${id}: ${explain(e)}`;
    }
  }),

  bindTool("read_skill_reference", async (input) => {
    const id = str(input, "id");
    const path = str(input, "path");
    try {
      const skill = requireSkill(
        id,
        PgAssistant.skills,
        PgAssistant.enabledSkillIds
      );
      PgAssistant.addToolCall(`read ${skill.id}/${path}`);
      return await loadReference(skill, path);
    } catch (e) {
      return `Could not read ${path} from ${id}: ${explain(e)}`;
    }
  }),
];

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;
  type SkillEntry = import("../grounding").SkillEntry;

  describe("views/sidebar/assistant/model/skill-tools", () => {
    const SOLANA_DEV: SkillEntry = {
      id: "solana-dev",
      name: "Official Solana developer skill",
      description: "d",
      source: {
        type: "remote",
        baseUrl: "https://skills.test/solana-dev/",
        entry: "SKILL.md",
      },
      enabled: true,
    };

    const tool = (name: string) => {
      const found = createSkillTools().find((t) => t.name === name);
      if (!found) throw new Error(`no tool ${name}`);
      return found;
    };

    /** The server lists `solana-dev`; the user has it on or off */
    const listed = (on: boolean) => {
      vi.spyOn(PgAssistant, "skills", "get").mockReturnValue([SOLANA_DEV]);
      vi.spyOn(PgAssistant, "enabledSkillIds", "get").mockReturnValue(
        on ? [SOLANA_DEV.id] : []
      );
      const fetch = vi.fn(async () => new Response("# skill", { status: 200 }));
      vi.stubGlobal("fetch", fetch);
      const addToolCall = vi.spyOn(PgAssistant, "addToolCall");
      return { fetch, addToolCall };
    };

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("refuses to load a skill switched off, without fetching it", async () => {
      const { fetch, addToolCall } = listed(false);

      const result = await tool("load_skill").run({ id: "solana-dev" });

      expect(result).toMatch(/^Could not load solana-dev: .*switched off/);
      expect(fetch).not.toHaveBeenCalled();
      expect(addToolCall).not.toHaveBeenCalled();
    });

    it("refuses to read a reference of a skill switched off", async () => {
      const { fetch, addToolCall } = listed(false);

      const result = await tool("read_skill_reference").run({
        id: "solana-dev",
        path: "references/security.md",
      });

      expect(result).toMatch(
        /^Could not read references\/security.md from solana-dev: .*switched off/
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(addToolCall).not.toHaveBeenCalled();
    });

    it("still tells an unknown id apart from one switched off", async () => {
      listed(true);

      const result = await tool("load_skill").run({ id: "no-such-skill" });

      expect(result).toMatch(/There is no skill with id "no-such-skill"/);
    });

    it("loads a skill that is on, naming it once in the tool-call line", async () => {
      const { addToolCall } = listed(true);

      const result = await tool("load_skill").run({ id: "solana-dev" });

      expect(result).toBe("# skill");
      // The catalogue's name already ends in "skill"
      expect(addToolCall).toHaveBeenCalledWith(`loaded ${SOLANA_DEV.name}`);
      expect(addToolCall.mock.calls[0][0]).not.toMatch(/skill skill/);
    });
  });
}
