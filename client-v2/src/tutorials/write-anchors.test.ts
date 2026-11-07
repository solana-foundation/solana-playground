import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import type {
  Beat,
  Block,
  Step,
  TutorialDefinition,
} from "@/entities/tutorial";
import { checkDefinition } from "@/entities/tutorial/model/definition/check";
import {
  groundOf,
  insertBlock,
} from "@/features/tutorial-conversation/model/landing";

import prototype from "./__tests__/write-anchors/prototype-step1.json";
import hello from "./hello-anchor/tutorial.json";

/**
 * Step 1 of Lumberjack and Zero Copy, dumped from Almaz's prototype
 * (`origin/almaz/mobile-tutorial-prototype`, `tutorial-v2/lessons`): every
 * write with its own `ref` and `start`. Step 1 builds a planned failure, so
 * its writes build code the step's target does not hold as written, and the
 * lesson's text quotes that build's line numbers.
 */

interface Write {
  id: string;
  file: string;
  block: string;
  ref?: string;
  start?: string;
}

interface Lesson {
  file: string;
  start: string;
  target: string;
  writes: Write[];
}

const LESSONS = prototype as Record<"lumberjack" | "zeroCopy", Lesson>;

/** Every conversation tutorial in this folder, by slug */
const TUTORIALS = Object.fromEntries(
  readdirSync(__dirname, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !/^[_.]/.test(e.name))
    .filter((e) => existsSync(join(__dirname, e.name, "tutorial.json")))
    .map((e) => [
      e.name,
      JSON.parse(
        readFileSync(join(__dirname, e.name, "tutorial.json"), "utf8")
      ) as TutorialDefinition,
    ])
);

/** A step's block writes in the order a run plays them: its beats, a right
 * pick's write included, then the planned failure's */
const writesOf = (step: Step): [string, Block][] =>
  step.beats.concat(step.onFail ?? []).flatMap((b): [string, Block][] => {
    if (b.kind === "write" && !("create" in b.writes))
      return [[b.id, b.writes]];
    if (b.kind === "ask" && b.writes) return [[b.id, b.writes]];
    return [];
  });

/** The fix question's id: the planned failure's beats start with `f1.` */
const isFix = (w: Write) => w.id.startsWith("f1.");

/** Step 1 as the definition carries it, for one file */
const stepOf = (lesson: Lesson) => ({
  start: { [lesson.file]: lesson.start },
  target: { [lesson.file]: lesson.target },
});

/** The file after each write, every write landing through `groundOf` */
const replay = (lesson: Lesson, writes: Write[]) => {
  const step = stepOf(lesson);
  let code = lesson.start;
  const appended: string[] = [];
  for (const write of writes) {
    const { reference, start } = groundOf(write, step);
    const placed = insertBlock(code, write.block, reference, start);
    if (placed.appended) appended.push(write.id);
    code = placed.code;
  }
  return { code, appended };
};

/** Hello Anchor with its first step's beats replaced by the lesson's writes */
const definitionWith = (lesson: Lesson, writes: Write[]): unknown => {
  const d = JSON.parse(JSON.stringify(hello)) as TutorialDefinition;
  const first = d.steps[0] as Step;
  first.file = lesson.file;
  first.start = stepOf(lesson).start;
  first.target = stepOf(lesson).target;
  first.beats = writes.map(
    (w): Beat => ({
      kind: "write",
      id: w.id,
      text: "Written.",
      writes: { file: w.file, block: w.block, ref: w.ref, start: w.start },
    })
  );
  delete first.planned;
  delete first.onFail;
  return JSON.parse(JSON.stringify(d));
};

/** The check's errors about the first step's beats */
const beatErrors = (definition: unknown) =>
  checkDefinition(definition, new Set([hello.finish.next ?? ""])).filter((e) =>
    e.path.startsWith("steps[0].beats")
  );

describe("tutorials/write-anchors", () => {
  describe.each(Object.entries(LESSONS))("%s step 1", (_, lesson) => {
    const build = lesson.writes.filter((w) => !isFix(w));
    const brokenBuild = build[build.length - 1].ref;

    it("builds the planned failure exactly as the prototype, nothing appended", () => {
      const { code, appended } = replay(lesson, build);
      expect(appended).toEqual([]);
      expect(code).toBe(brokenBuild?.trimEnd());
    });

    it("lands the fix in place and reaches the step's target", () => {
      const { code, appended } = replay(lesson, lesson.writes);
      expect(appended).toEqual([]);
      expect(code).toBe(lesson.target.trimEnd());
    });

    it("passes the check with every write's own ref", () => {
      expect(beatErrors(definitionWith(lesson, lesson.writes))).toEqual([]);
    });
  });

  it.each(Object.entries(LESSONS))(
    "%s: without the refs a write of the planned failure lands elsewhere",
    (_, lesson) => {
      const build = lesson.writes.filter((w) => !isFix(w));
      const bare = build.map((w) => ({
        id: w.id,
        file: w.file,
        block: w.block,
      }));
      const differs = build.some(
        (_w, k) =>
          replay(lesson, build.slice(0, k + 1)).code !==
          replay(lesson, bare.slice(0, k + 1)).code
      );
      expect(differs).toBe(true);
    }
  );

  it("Zero Copy's fix never reaches its target without the refs", () => {
    const lesson = LESSONS.zeroCopy;
    const targetOnly = replay(
      lesson,
      lesson.writes.map((w) => ({ id: w.id, file: w.file, block: w.block }))
    ).code;
    expect(targetOnly).not.toBe(lesson.target.trimEnd());
  });

  describe.each(Object.entries(TUTORIALS))(
    "%s: every write lands in place",
    (_, definition) => {
      it.each(definition.steps.map((s, i) => [s.id, i] as const))(
        "step %s",
        (_id, i) => {
          const step = definition.steps[i];
          const files: Record<string, string> = JSON.parse(
            JSON.stringify(step.start)
          );
          const appended: string[] = [];
          for (const [id, write] of writesOf(step)) {
            const { reference, start } = groundOf(write, step);
            const placed = insertBlock(
              files[write.file] ?? "",
              write.block,
              reference,
              start
            );
            if (placed.appended) appended.push(id);
            files[write.file] = placed.code;
          }
          expect(appended).toEqual([]);
        }
      );
    }
  );

  describe("the check", () => {
    const lesson = LESSONS.lumberjack;
    const found = lesson.writes.find((w) => w.id === "s1.accounts");
    if (!found?.ref) throw new Error("Lumberjack's s1.accounts has a ref");
    const accounts = { block: found.block, ref: found.ref };

    it("needs a block with a ref to appear in it", () => {
      const write: Write = {
        id: "s1.accounts",
        file: lesson.file,
        block: "pub fn goodbye() {}",
        ref: accounts.ref,
      };
      expect(
        beatErrors(definitionWith(lesson, [write])).map((e) => e.path)
      ).toEqual(["steps[0].beats[0].writes.block"]);
    });

    it("needs a block to appear in its ref once", () => {
      const write: Write = {
        id: "s1.accounts",
        file: lesson.file,
        block: accounts.block,
        ref: `${accounts.ref}\n\n${accounts.block}\n`,
      };
      expect(
        beatErrors(definitionWith(lesson, [write])).map((e) => e.path)
      ).toEqual(["steps[0].beats[0].writes.ref"]);
    });

    it("checks the ref of a fix question in the planned failure", () => {
      const d = JSON.parse(JSON.stringify(hello)) as TutorialDefinition;
      const k = (d.steps[0].onFail ?? []).findIndex(
        (b) => b.kind === "ask" && b.writes
      );
      const fix = d.steps[0].onFail?.[k];
      if (fix?.kind !== "ask" || !fix.writes) {
        throw new Error("Hello Anchor's planned failure has a fix question");
      }
      fix.writes.ref = "pub fn goodbye() {}\n";
      expect(
        checkDefinition(d, new Set([hello.finish.next ?? ""])).map(
          (e) => e.path
        )
      ).toEqual([`steps[0].onFail[${k}].writes.block`]);
    });

    it("checks a ref's block there, not in the step's target", () => {
      const write: Write = {
        id: "s1.accounts",
        file: lesson.file,
        block: "    pub only_in_the_ref: u8,",
        ref: `${accounts.ref}\n    pub only_in_the_ref: u8,\n`,
      };
      expect(beatErrors(definitionWith(lesson, [write]))).toEqual([]);
    });
  });
});
