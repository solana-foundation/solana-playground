import { createLogger, toError } from "@/shared/lib/logger";

import { tutorialTelemetry } from "../telemetry";
import { checkDefinition, formatError } from "./check";
import type { TutorialDefinition } from "./types";

const log = createLogger("tutorial:definition");

/** A definition the check accepted, under its folder's slug */
export interface LoadedDefinition {
  slug: string;
  definition: TutorialDefinition;
}

/**
 * The definitions that pass their check, in the order given. Each one that
 * fails, or whose check throws, is left out, logged once with its slug and
 * its first error (reported, since CI's `yarn tutorial:check` should have
 * stopped it), and counted as `tutorial_definition_rejected`.
 *
 * @param known every tutorial slug a definition's `next` may name
 * @param docPages each tutorial's `docs/` Markdown by file name, by slug; a
 *   tutorial missing here has its doc files left unchecked
 * @returns a loader of parsed `tutorial.json` files by slug
 */
export const loadDefinitionsWith =
  (
    known: ReadonlySet<string>,
    docPages: Readonly<Record<string, Readonly<Record<string, string>>>>
  ) =>
  (raw: Record<string, unknown>): LoadedDefinition[] =>
    Object.entries(raw).flatMap(([slug, json]) => {
      let errors: string[];
      try {
        errors = checkDefinition(json, known, {
          slug,
          docs: docPages[slug],
        }).map(formatError);
      } catch (e) {
        // One definition the check cannot read must not take the catalog down
        errors = [`the check failed: ${toError(e).message}`];
      }
      if (errors.length === 0) {
        return [{ slug, definition: json as TutorialDefinition }];
      }
      // TODO(HOO-2369): this runs while the app's modules load, before
      // `initObservability` installs Sentry, and the logger keeps nothing from
      // before then, so this reaches the console only; the event below is
      // buffered and does arrive
      log.error(new Error(`tutorial "${slug}" is not listed: ${errors[0]}`), {
        report: true,
        context: { tutorial: slug, errors: errors.length },
      });
      tutorialTelemetry.track("tutorial_definition_rejected", {
        tutorial: slug,
        errors: errors.length,
      });
      return [];
    });

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll, beforeEach, afterEach } = import.meta
    .vitest;

  describe("entities/tutorial/model/definition/load", () => {
    let logger: typeof import("@/shared/lib/logger");
    let telemetry: typeof import("@/shared/lib/telemetry");
    let helloAnchor: unknown;
    beforeAll(async () => {
      logger = await import("@/shared/lib/logger");
      telemetry = await import("@/shared/lib/telemetry");
      helloAnchor = (
        await import("../../../../tutorials/hello-anchor/tutorial.json")
      ).default;
    });

    let logged: ReturnType<typeof import("@/shared/lib/logger").memoryProvider>;
    let events: ReturnType<
      typeof import("@/shared/lib/telemetry").memoryProvider
    >;
    beforeEach(() => {
      logged = logger.memoryProvider();
      logger.initLogger({ providers: [logged] });
      events = telemetry.memoryProvider();
      telemetry.initTelemetry({ providers: [events] });
    });
    afterEach(() => {
      logger.resetLogger();
      telemetry.resetTelemetry();
    });

    const KNOWN = new Set(["hello-anchor", "lumberjack"]);

    /** Hello Anchor with two schema errors: no minutes, a level no one has */
    const broken = () => {
      const d = structuredClone(helloAnchor) as Record<string, unknown>;
      delete d.minutes;
      d.level = "Expert";
      return d;
    };

    it("keeps a definition that passes, under its slug", () => {
      const loaded = loadDefinitionsWith(
        KNOWN,
        {}
      )({ "hello-anchor": helloAnchor });
      expect(loaded.map((l) => l.slug)).toEqual(["hello-anchor"]);
      expect(loaded[0].definition.steps).toHaveLength(4);
      expect(events.events).toEqual([]);
    });

    it("drops a broken definition and keeps the others", () => {
      const loaded = loadDefinitionsWith(
        KNOWN,
        {}
      )({ "hello-anchor": helloAnchor, broken: broken() });
      expect(loaded.map((l) => l.slug)).toEqual(["hello-anchor"]);
    });

    it("counts a rejection once, with its slug and its number of errors", () => {
      loadDefinitionsWith(KNOWN, {})({ broken: broken() });
      expect(events.events).toEqual([
        {
          name: "tutorial_definition_rejected",
          params: { tutorial: "broken", errors: 2 },
          scope: undefined,
        },
      ]);
    });

    it("drops a definition whose listed doc page is not in its folder", () => {
      const listed = structuredClone(helloAnchor) as Record<string, unknown>;
      listed.docs = [
        {
          title: "IDL",
          url: "https://www.anchor-lang.com/docs/basics/idl",
          file: "idl.md",
        },
      ];
      expect(
        loadDefinitionsWith(KNOWN, { "hello-anchor": {} })({
          "hello-anchor": listed,
        })
      ).toEqual([]);
      expect(logged.entries[0].error?.message).toBe(
        'tutorial "hello-anchor" is not listed: docs[0].file: a Markdown file in the tutorial\'s docs folder, found no "idl.md" there'
      );
    });

    it("rejects a definition whose check throws, and keeps the others", () => {
      // A getter that throws stands for any shape the check cannot read
      const hostile = {};
      Object.defineProperty(hostile, "version", {
        enumerable: true,
        get: () => {
          throw new Error("unreadable");
        },
      });
      const loaded = loadDefinitionsWith(
        KNOWN,
        {}
      )({ "hello-anchor": helloAnchor, hostile });
      expect(loaded.map((l) => l.slug)).toEqual(["hello-anchor"]);
      expect(events.events).toEqual([
        {
          name: "tutorial_definition_rejected",
          params: { tutorial: "hostile", errors: 1 },
          scope: undefined,
        },
      ]);
    });

    it("logs a rejection once, naming the slug and its first error", () => {
      loadDefinitionsWith(KNOWN, {})({ broken: broken() });
      expect(logged.entries).toHaveLength(1);
      expect(logged.entries[0].ns).toBe("tutorial:definition");
      expect(logged.entries[0].report).toBe(true);
      expect(logged.entries[0].error?.message).toBe(
        'tutorial "broken" is not listed: (root): needs "minutes", found none'
      );
    });
  });
}
