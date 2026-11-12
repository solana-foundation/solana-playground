/** The tutorial in the URL, as far as the stages care */
export type OpenTutorial =
  | { kind: "none" }
  /**
   * Started at its intro card's Start, after its workspace is made; Start
   * over takes it back to the intro, and the stages go with it
   */
  | { kind: "definition"; conversationStarted: boolean }
  /**
   * Started at the Start that makes its workspace; `workspaces` is undefined
   * until the explorer knows them
   */
  | {
      kind: "upstream";
      name: string;
      workspaces: readonly string[] | undefined;
    };

/**
 * Whether the stages (Write, Build, Deploy, Interact, and their Ctrl+1..4
 * keys) are offered. Not while the tutorial in the URL (`PgTutorial.current`)
 * is unstarted: its intro, or upstream's About page, has Start as its only
 * action (Almaz's prototype, `tutorial-v2/SPEC.md` 9.2), and a stage reached
 * before it built a project that did not exist yet. A bug fix with a
 * ticket, HOO-2365, whose acceptance is its proposal; no spec delta covers it.
 */
export const offersStages = (open: OpenTutorial): boolean => {
  switch (open.kind) {
    case "none":
      return true;
    case "definition":
      return open.conversationStarted;
    case "upstream":
      // `PgTutorial.isStarted`'s own test, without its throw on a cold load
      return open.workspaces?.includes(open.name) ?? false;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/stages-offered", () => {
    it("offers the stages outside a tutorial", () => {
      expect(offersStages({ kind: "none" })).toBe(true);
    });

    it("offers them in a definition tutorial only after its Start", () => {
      expect(
        offersStages({ kind: "definition", conversationStarted: false })
      ).toBe(false);
      expect(
        offersStages({ kind: "definition", conversationStarted: true })
      ).toBe(true);
    });

    it("offers them in an upstream tutorial once its workspace exists", () => {
      const open = (workspaces: readonly string[] | undefined) =>
        offersStages({ kind: "upstream", name: "Hello Seahorse", workspaces });
      expect(open(["Counter"])).toBe(false);
      expect(open(["Counter", "Hello Seahorse"])).toBe(true);
    });

    it("offers none before the explorer knows its workspaces", () => {
      expect(
        offersStages({
          kind: "upstream",
          name: "Hello Seahorse",
          workspaces: undefined,
        })
      ).toBe(false);
    });
  });
}
