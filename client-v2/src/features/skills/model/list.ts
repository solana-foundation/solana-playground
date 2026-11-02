import { createLogger } from "@/shared/lib/logger";
import { BUNDLED_SKILLS } from "./registry";
import type { ListedSkill, SkillEntry } from "./types";

const log = createLogger("skills:list");

/** The route that lists the skills this deployment offers the caller */
const ROUTE = "/api/skills";

/**
 * A listed skill as the assistant loads it: a bundled one takes its text from
 * the bundle, and is left out when the bundle has none for its id.
 */
const toEntry = (skill: ListedSkill): SkillEntry | undefined => {
  if (skill.source.type === "remote") return skill as SkillEntry;
  // Own keys only: an id such as `constructor` reads a function off the prototype
  const content = Object.hasOwn(BUNDLED_SKILLS, skill.id)
    ? BUNDLED_SKILLS[skill.id]
    : undefined;
  if (content === undefined) {
    log.warn("The server listed a bundled skill this bundle does not have", {
      context: { id: skill.id },
    });
    return undefined;
  }
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    source: { type: "bundled", content },
    enabled: skill.enabled,
    community: skill.community,
  };
};

/**
 * Ask the server which skills it offers this caller.
 *
 * The server owns the list, so a skill the operator withheld is absent for
 * every backend. There is no built-in fallback: a failure means no skills.
 *
 * @throws when the route cannot be reached or does not answer 200
 */
export const listGatewaySkills = async (): Promise<SkillEntry[]> => {
  try {
    const response = await fetch(ROUTE, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `${ROUTE} answered ${response.status} ${response.statusText}`
      );
    }
    const body = (await response.json()) as { skills?: ListedSkill[] };
    return (body.skills ?? [])
      .map(toEntry)
      .filter((skill): skill is SkillEntry => skill !== undefined);
  } catch (error) {
    log.error(error, { context: { route: ROUTE } });
    throw error;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach, afterEach } = import.meta
    .vitest;

  describe("features/skills/model/list", () => {
    let entries: import("@/shared/lib/logger").LogEntry[];

    const listed = (skills: unknown[]) =>
      vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ skills }), { status: 200 })
        );

    const bundled = (id: string) => ({
      id,
      name: id,
      description: "d",
      enabled: true,
      source: { type: "bundled" },
    });

    const remote = {
      id: "solana-dev",
      name: "solana-dev",
      description: "d",
      enabled: true,
      source: {
        type: "remote",
        baseUrl: "https://skills.test/solana-dev/",
        entry: "SKILL.md",
      },
    };

    beforeEach(async () => {
      const { initLogger, memoryProvider } = await import(
        "@/shared/lib/logger"
      );
      const memory = memoryProvider();
      entries = memory.entries;
      initLogger({ providers: [memory] });
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      const { resetLogger } = await import("@/shared/lib/logger");
      resetLogger();
    });

    it("The server lists both Foundation skills: the bundled one loads with no request", async () => {
      listed([bundled("playground-env"), remote]);

      const skills = await listGatewaySkills();

      expect(skills.map((skill) => skill.id)).toEqual([
        "playground-env",
        "solana-dev",
      ]);
      expect(skills[0].source).toEqual({
        type: "bundled",
        content: BUNDLED_SKILLS["playground-env"],
      });
    });

    it("A bundled id the bundle does not know: left out and logged by id", async () => {
      // An inherited property name, so a lookup that reads the prototype loads a function as the text
      listed([bundled("constructor"), remote]);

      const skills = await listGatewaySkills();

      expect(skills.map((skill) => skill.id)).toEqual(["solana-dev"]);
      expect(entries).toEqual([
        expect.objectContaining({
          level: "warn",
          context: { id: "constructor" },
        }),
      ]);
    });

    it("rejects and logs when the route fails, with no list of its own", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{}", { status: 404, statusText: "Not Found" })
      );

      await expect(listGatewaySkills()).rejects.toThrow(/404/);
      expect(entries.map((entry) => entry.level)).toEqual(["error"]);
    });
  });
}
