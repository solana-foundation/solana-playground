/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Act, ActBeat, ActionWord } from "@/entities/tutorial";

import type { WordAction } from "./reducer";
import type { Turn } from "./view";

/** The live actions a composer message can name on its own */
export type Word = ActionWord;

/** Each word as typed, to the action it names; "begin" and "go" start too */
const WORDS: Record<string, Word> = {
  start: "start",
  begin: "start",
  go: "start",
  build: "build",
  deploy: "deploy",
  run: "run",
  call: "call",
  next: "next",
  explain: "explain",
};

/** The acts each word runs: a build-and-deploy card answers both words */
const ACTS: Record<"build" | "deploy" | "run" | "call", readonly Act[]> = {
  build: ["build", "buildDeploy"],
  deploy: ["deploy", "buildDeploy"],
  run: ["run"],
  call: ["call"],
};

/**
 * The word a message is, or null when it is anything else: one action word,
 * alone or with "please" before or after it, in any case, with trailing
 * punctuation. "build it" is not a word; it goes to the assistant.
 */
export const wordOf = (text: string): Word | null => {
  const parts = text
    .trim()
    .toLowerCase()
    .split(/\s+/)
    // Each part's own punctuation: "please, build" as much as "build!"
    .map((part) => part.replace(/[.!?,]+$/, ""))
    .filter((part) => part !== "please" && part !== "");
  if (parts.length !== 1) return null;
  return WORDS[parts[0]] ?? null;
};

/** Where a composer message goes (`route`), with the word it matched */
export type Route =
  | { kind: "word"; word: Word; action: WordAction }
  | { kind: "refused"; word: Word }
  | { kind: "assistant" };

/**
 * Where a composer message goes, in the spec's order: a word while a
 * question is open is refused, a word whose action is live runs it at `at`,
 * and anything else is the assistant's. A word with nothing live to run is
 * the assistant's too, so a learner asking "deploy?" on step 1 with no
 * question open gets an answer rather than silence. Finish chips are
 * pressed, never matched from text.
 */
export const route = (text: string, live: Turn | null, at: number): Route => {
  const word = wordOf(text);
  if (!word || !live) return { kind: "assistant" };
  if (live.kind === "ask" && live.open) return { kind: "refused", word };
  const action = actionFor(word, live, at);
  return action ? { kind: "word", word, action } : { kind: "assistant" };
};

/**
 * The fields a call act asks the learner to fill: its string arguments.
 * The same rule stands in `BaseActCard` (one field each) and the feed's ⌘↵
 * handler (`TutorialConversation`), which wait for them as this does. It is
 * not shared: the entity's entry, its one home all three could import,
 * loads UI that needs the build's globals, and the props-only card cannot
 * import the engine.
 */
const callFields = (act: ActBeat): string[] =>
  act.act === "call"
    ? (act.call.args ?? []).filter((a): a is string => typeof a === "string")
    : [];

const actionFor = (word: Word, live: Turn, at: number): WordAction | null => {
  switch (word) {
    case "start":
      return live.kind === "intro" ? { type: "start", at } : null;
    case "next":
      return live.kind === "win" ? { type: "next", at } : null;
    case "explain":
      return live.kind === "result" && live.open
        ? { type: "explain", beatId: live.beatId, at }
        : null;
    case "build":
    case "deploy":
    case "run":
    case "call": {
      if (live.kind !== "act" || live.state === "running") return null;
      if (!ACTS[word].includes(live.act.act)) return null;
      // A call with a field for the learner to fill waits for its own
      // fields, as ⌘↵ does: the word is the assistant's to answer
      if (callFields(live.act).length) return null;
      return { type: "act", beatId: live.beatId, at };
    }
    default: {
      const never: never = word;
      return never;
    }
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/tutorial-conversation/model/route", () => {
    /** A turn's common fields, named once */
    const turnOf = (id: string) => ({
      id,
      step: "write-program",
      at: 1,
      whole: false,
    });
    const intro: Turn = {
      id: "intro",
      step: null,
      at: 1,
      whole: false,
      kind: "intro",
    };
    const openAsk: Turn = Object.assign(turnOf("s1.q1"), {
      kind: "ask" as const,
      beatId: "s1.q1",
      ask: {
        kind: "ask" as const,
        id: "s1.q1",
        kicker: "Question" as const,
        question: "Where does msg! print?",
        options: ["a", "b", "c"] as [string, string, string],
        code: false,
        answer: 0 as const,
        right: "Yes.",
        why: [null, "No.", "No."] as [null, string, string],
        hint: "The log.",
      },
      open: true,
      wrong: [],
      hinted: false,
      writeFailed: false,
      outcome: null,
      attempts: 0,
    });
    const act = (name: Exclude<Act, "call">, state: "live" | "running"): Turn =>
      Object.assign(turnOf("s1.build"), {
        kind: "act" as const,
        presses: [],
        beatId: "s1.build",
        act: {
          kind: "act" as const,
          id: "s1.build",
          title: "Build",
          context: "",
          button: "Build",
          act: name,
        },
        state,
        note: null,
        stage: null,
        took: null,
      });

    it("reads one action word, with please, any case and a full stop", () => {
      expect(wordOf("build")).toBe("build");
      expect(wordOf("  Please DEPLOY. ")).toBe("deploy");
      expect(wordOf("next please!")).toBe("next");
      expect(wordOf("Go")).toBe("start");
      expect(wordOf("please, build")).toBe("build");
      expect(wordOf("build it")).toBeNull();
      expect(wordOf("what does build do?")).toBeNull();
      expect(wordOf("please")).toBeNull();
      expect(wordOf("")).toBeNull();
    });

    it("runs a word whose action is live, at the message's own time", () => {
      expect(route("go", intro, 500)).toEqual({
        kind: "word",
        word: "start",
        action: { type: "start", at: 500 },
      });
      for (const word of ["start", "Begin", "go please"]) {
        expect(route(word, intro, 500)).toMatchObject({
          kind: "word",
          word: "start",
        });
      }
      expect(route("build", act("build", "live"), 500)).toEqual({
        kind: "word",
        word: "build",
        action: { type: "act", beatId: "s1.build", at: 500 },
      });
      expect(route("deploy", act("buildDeploy", "live"), 500)).toMatchObject({
        kind: "word",
        word: "deploy",
        action: { type: "act" },
      });
    });

    const call = (args: import("@/entities/tutorial").CallArg[]): Turn => ({
      id: "s4.call",
      presses: [],
      step: "write-program",
      at: 1,
      whole: false,
      kind: "act",
      beatId: "s4.call",
      act: {
        kind: "act",
        id: "s4.call",
        title: "Call",
        context: "",
        button: "Call",
        act: "call",
        call: { instruction: "hello", args },
      },
      state: "live",
      note: null,
      stage: null,
      took: null,
    });

    it("runs a typed call only when the act has no field left to fill", () => {
      expect(
        route("call", call([{ name: "name", value: "Alex" }]), 500)
      ).toEqual({
        kind: "word",
        word: "call",
        action: { type: "act", beatId: "s4.call", at: 500 },
      });
      // The name field waits for the learner, as ⌘↵ does
      expect(route("call please", call(["name"]), 500)).toEqual({
        kind: "assistant",
      });
    });

    it("refuses any word while a question is open, before matching it", () => {
      expect(route("build", openAsk, 500)).toEqual({
        kind: "refused",
        word: "build",
      });
      expect(route("next please", openAsk, 500)).toEqual({
        kind: "refused",
        word: "next",
      });
    });

    it("sends everything else to the assistant", () => {
      expect(route("I'm stuck", openAsk, 500)).toEqual({ kind: "assistant" });
      expect(route("what does declare_id do?", intro, 500)).toEqual({
        kind: "assistant",
      });
      expect(route("go ahead", intro, 500)).toEqual({ kind: "assistant" });
      // A word with nothing live to run
      expect(route("deploy", act("build", "live"), 500)).toEqual({
        kind: "assistant",
      });
      expect(route("build", act("build", "running"), 500)).toEqual({
        kind: "assistant",
      });
      expect(route("next", intro, 500)).toEqual({ kind: "assistant" });
      expect(route("build", null, 500)).toEqual({ kind: "assistant" });
    });
  });
}
