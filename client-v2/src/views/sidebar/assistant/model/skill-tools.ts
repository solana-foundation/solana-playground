import { PgAssistant } from "../store";
import {
  describeCatalog,
  loadReference,
  loadSkill,
  requireEnabledSkill,
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
    return describeCatalog(PgAssistant.enabledSkillIds);
  }),

  bindTool("load_skill", async (input) => {
    const id = str(input, "id");
    try {
      const skill = requireEnabledSkill(id, PgAssistant.enabledSkillIds);
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
      const skill = requireEnabledSkill(id, PgAssistant.enabledSkillIds);
      PgAssistant.addToolCall(`read ${skill.id}/${path}`);
      return await loadReference(skill, path);
    } catch (e) {
      return `Could not read ${path} from ${id}: ${explain(e)}`;
    }
  }),
];

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, afterEach } = import.meta.vitest;
  describe("views/sidebar/assistant/model/skill-tools", () => {
    let DEFAULT_SKILL_IDS: typeof import("../grounding").DEFAULT_SKILL_IDS;
    let findSkill: typeof import("../grounding").findSkill;
    beforeAll(async () => {
      ({ DEFAULT_SKILL_IDS, findSkill } = await import("../grounding"));
    });

    const tool = (name: string) => {
      const found = createSkillTools().find((t) => t.name === name);
      if (!found) throw new Error(`no tool ${name}`);
      return found;
    };

    /** Untick `id` and watch for anything that would read or log it */
    const untick = (id: string) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const addToolCall = vi.spyOn(PgAssistant, "addToolCall");
      PgAssistant.setSkillEnabled(id, false);
      return { fetch, addToolCall };
    };

    afterEach(() => {
      for (const id of DEFAULT_SKILL_IDS) PgAssistant.setSkillEnabled(id, true);
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("refuses to load a skill the user unticked, without fetching it", async () => {
      const { fetch, addToolCall } = untick("solana-dev");

      const result = await tool("load_skill").run({ id: "solana-dev" });

      expect(result).toMatch(
        /^Could not load solana-dev: the skill is disabled/
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(addToolCall).not.toHaveBeenCalled();
    });

    it("refuses to load an unticked bundled skill", async () => {
      const { addToolCall } = untick("playground-env");

      const result = await tool("load_skill").run({ id: "playground-env" });

      expect(result).toMatch(
        /^Could not load playground-env: the skill is disabled/
      );
      expect(addToolCall).not.toHaveBeenCalled();
    });

    it("refuses to read a reference of a skill the user unticked", async () => {
      const { fetch, addToolCall } = untick("solana-dev");

      const result = await tool("read_skill_reference").run({
        id: "solana-dev",
        path: "references/security.md",
      });

      expect(result).toMatch(
        /^Could not read references\/security.md from solana-dev: the skill is disabled/
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(addToolCall).not.toHaveBeenCalled();
    });

    it("still tells an unknown id apart from a disabled one", async () => {
      const result = await tool("load_skill").run({ id: "no-such-skill" });

      expect(result).toMatch(/There is no skill with id "no-such-skill"/);
    });

    it("loads a skill ticked again, naming it once in the tool-call line", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("# skill", { status: 200 }))
      );
      const addToolCall = vi.spyOn(PgAssistant, "addToolCall");
      PgAssistant.setSkillEnabled("solana-dev", false);
      PgAssistant.setSkillEnabled("solana-dev", true);

      const result = await tool("load_skill").run({ id: "solana-dev" });

      expect(result).toBe("# skill");
      // The registry name already ends in "skill"
      expect(addToolCall).toHaveBeenCalledWith(
        `loaded ${findSkill("solana-dev")?.name}`
      );
      expect(addToolCall.mock.calls[0][0]).not.toMatch(/skill skill/);
    });
  });
}
