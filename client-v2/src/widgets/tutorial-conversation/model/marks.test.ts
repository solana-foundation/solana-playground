/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { describe, expect, it, vi } from "vitest";

import type { Ask, TutorialDefinition } from "@/entities/tutorial";
import type { ConversationView, Turn } from "@/features/tutorial-conversation";
import { requireFor } from "@/test-utils/require-for";

import helloJson from "../../../tutorials/hello-anchor/tutorial.json";

// The engine's entry also exports its store, which drags in the app's
// generated globals; the marks need only the pure engine behind it
vi.mock("@/features/tutorial-conversation", async () => ({
  landingFor: (await import("@/features/tutorial-conversation/model/landing"))
    .landingFor,
  stepOfBeat: (await import("@/features/tutorial-conversation/model/reducer"))
    .stepOfBeat,
}));

import { marksOf } from "./marks";

describe("widgets/tutorial-conversation/model/marks", () => {
  const hello = helloJson as unknown as TutorialDefinition;
  const ask = requireFor("a question beat")(
    hello.steps[0].beats.find((b): b is Ask => b.kind === "ask")
  );
  const NONE = { written: [], arriving: false, landing: null };

  const BOILER =
    'use anchor_lang::prelude::*;\n\ndeclare_id!("11111111111111111111111111111111");';

  const askTurn = (open: boolean): Turn => ({
    id: ask.id,
    kind: "ask",
    step: "write-program",
    at: 2,
    whole: false,
    beatId: ask.id,
    ask,
    open,
    wrong: [],
    hinted: false,
    writeFailed: false,
    outcome: open ? null : "first_try",
    attempts: open ? 0 : 1,
  });
  const openAsk = () => askTurn(true);
  const wroteCard = (lines: number[], whole: boolean, step: string): Turn => ({
    id: `wrote:${step}`,
    kind: "wrote",
    step,
    at: 1,
    whole,
    beatId: "s1.boil",
    wrote: { file: "src/lib.rs", lines },
    failed: false,
  });
  const viewOf = (turns: Turn[], live: Turn | null): ConversationView =>
    ({ turns, live } as unknown as ConversationView);

  it("lands an open question's answer past the boilerplate as a ghost line", () => {
    const marks = marksOf(
      hello,
      viewOf([openAsk()], openAsk()),
      () => BOILER
    )("src/lib.rs");
    expect(marks.landing).toEqual({ lines: [5], ghost: true });
  });

  it("lights the live step's last write, arriving when it was posted after the load", () => {
    const fresh = wroteCard([1, 2, 3], false, "write-program");
    const opened = openAsk();
    const marks = marksOf(
      hello,
      viewOf([fresh, opened], opened),
      () => BOILER
    )("src/lib.rs");
    expect(marks.written).toEqual([1, 2, 3]);
    expect(marks.arriving).toBe(true);
    const restored = marksOf(
      hello,
      viewOf([wroteCard([1, 2, 3], true, "write-program"), opened], opened),
      () => BOILER
    )("src/lib.rs");
    expect(restored.arriving).toBe(false);
  });

  it("marks nothing in another file, or for a write from an earlier step", () => {
    const opened = openAsk();
    expect(
      marksOf(hello, viewOf([opened], opened), () => BOILER)("client/client.ts")
    ).toEqual(NONE);
    const old = wroteCard([5, 6], false, "deploy");
    expect(
      marksOf(hello, viewOf([old], null), () => BOILER)("src/lib.rs")
    ).toEqual(NONE);
  });

  it("draws no landing for an answered question, or for a file it cannot read", () => {
    const answered = askTurn(false);
    expect(
      marksOf(hello, viewOf([answered], answered), () => BOILER)("src/lib.rs")
        .landing
    ).toBeNull();
    const opened = openAsk();
    expect(
      marksOf(hello, viewOf([opened], opened), () => null)("src/lib.rs")
    ).toEqual(NONE);
  });

  it("lights the last of two writes in the file on the live step", () => {
    const opened = openAsk();
    const first = wroteCard([1, 2, 3], true, "write-program");
    const second: Turn = {
      id: "wrote:second",
      kind: "wrote",
      step: "write-program",
      at: 3,
      whole: true,
      beatId: "s1.q1",
      wrote: { file: "src/lib.rs", lines: [5, 6] },
      failed: false,
    };
    expect(
      marksOf(
        hello,
        viewOf([first, second, opened], opened),
        () => BOILER
      )("src/lib.rs").written
    ).toEqual([5, 6]);
  });
});
