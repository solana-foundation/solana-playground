// By module, not the barrels: `@/entities/tutorial` and `../utils` load UI
// that reads the build's globals on import, which a unit test does not have
import { slugOf } from "@/entities/tutorial/model/definition/check";
import { loadDefinitionsWith } from "@/entities/tutorial/model/definition/load";

import type { TutorialData } from "../utils/tutorial/types";
import { DEFINITION_FILES } from "./_definitions/generated";

/**
 * The conversation tutorials, one per valid `src/tutorials/<slug>/tutorial.json`.
 * A definition that fails its check is left out (and reported) by
 * `loadDefinitionsWith`; `others` are the tutorials its `next` may also name, by
 * the slug of their name, as `yarn tutorial:check` reads them.
 */
export const definitionTutorials = (others: TutorialData[]): TutorialData[] => {
  const known = new Set([
    ...Object.keys(DEFINITION_FILES),
    ...others.map((t) => slugOf(t.name)),
  ]);
  const raw = Object.fromEntries(
    Object.entries(DEFINITION_FILES).map(([slug, file]) => [slug, file.json])
  );
  const docPages = Object.fromEntries(
    Object.entries(DEFINITION_FILES).map(([slug, file]) => [
      slug,
      file.docPages,
    ])
  );
  return loadDefinitionsWith(
    known,
    docPages
  )(raw).map(({ slug, definition: d }) => ({
    name: d.name,
    description: d.description,
    authors: d.authors,
    level: d.level,
    framework: d.framework,
    languages: d.languages,
    categories: d.categories as TutorialData["categories"],
    thumbnail: DEFINITION_FILES[slug].thumbnail ?? d.thumbnail,
    pageCount: d.steps.length,
    unixTimestamp: DEFINITION_FILES[slug].unixTimestamp,
    // Never called: the route opens a definition on its intro card
    // (`openOnIntro`) and draws the editor itself. `TutorialData` requires one
    importComponent: () =>
      Promise.reject(
        new Error(`${d.name} opens in the conversation, not as a component`)
      ),
    definition: d,
    docPages: DEFINITION_FILES[slug].docPages,
  }));
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("tutorials/definitions", () => {
    /** The Markdown tutorial Hello Anchor's finish suggests next */
    const counterPda = { name: "Counter PDA Tutorial" } as TutorialData;

    it("lists Hello Anchor from its tutorial.json", () => {
      const hello = definitionTutorials([counterPda]).find(
        (t) => t.name === "Hello Anchor"
      );
      expect(hello?.definition?.steps.map((s) => s.short)).toEqual([
        "Program",
        "Deploy",
        "Client",
        "Name",
      ]);
      expect(hello?.pageCount).toBe(4);
      expect(hello?.level).toBe("Beginner");
      expect(hello?.thumbnail).toBe("/tutorials/hello-anchor/thumbnail.jpg");
    });

    it("carries Hello Anchor's four doc pages with their Markdown", () => {
      const hello = definitionTutorials([counterPda]).find(
        (t) => t.name === "Hello Anchor"
      );
      const docs = hello?.definition?.docs ?? [];
      expect(docs.map((doc) => doc.title)).toEqual([
        "Program Structure",
        "IDL",
        "Programs",
        "Transactions",
      ]);
      for (const doc of docs) {
        expect(hello?.docPages?.[doc.file]).toMatch(/^# /);
      }
    });

    it("gives Hello Anchor four questions and the planned failure in step 1", () => {
      const steps = definitionTutorials([counterPda]).find(
        (t) => t.name === "Hello Anchor"
      )?.definition?.steps;
      const asks = steps?.flatMap((s) =>
        s.beats.filter((b) => b.kind === "ask" && b.kicker === "Question")
      );
      expect(asks).toHaveLength(4);
      expect(steps?.[0].onFail?.map((b) => b.id)).toEqual([
        "f1.explain",
        "f1.q2",
        "f1.build",
      ]);
    });

    it("leaves out a definition whose next names no listed tutorial", () => {
      // Without Counter PDA Tutorial among the others, Hello Anchor's next
      // names nothing
      expect(definitionTutorials([]).map((t) => t.name)).toEqual([]);
    });
  });
}
