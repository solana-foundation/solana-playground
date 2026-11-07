import type { Idl } from "@coral-xyz/anchor";

import { readIdl } from "@/entities/idl";
import type { TutorialDefinition } from "@/entities/tutorial";
import { createLogger } from "@/shared/lib/logger";

import type { Cursor } from "./progress";

/**
 * The IDL a tutorial ships for where the learner is: the `idl` of the latest
 * step at or before the cursor's that carries one, in the 0.29 shape the
 * client calls with. The last one on the finish card; none on the intro, nor
 * in a tutorial that ships none, nor for one that cannot be called.
 *
 * It stands in for the build's, which Anchor 1.1.2 builds no longer return
 * (HOO-2688), until the build backend generates it again.
 */
export const shippedIdl = (
  definition: TutorialDefinition,
  cursor: Cursor
): Idl | undefined => {
  if (cursor.kind === "intro") return undefined;
  return cursor.kind === "step"
    ? shippedIdlAt(definition, cursor.stepId)
    : idlUntil(definition, definition.steps.length - 1);
};

/** The IDL a tutorial ships for one step: the latest at or before it */
export const shippedIdlAt = (
  definition: TutorialDefinition,
  stepId: string
): Idl | undefined =>
  idlUntil(
    definition,
    definition.steps.findIndex((s) => s.id === stepId)
  );

const idlUntil = (
  definition: TutorialDefinition,
  until: number
): Idl | undefined => {
  for (let i = until; i >= 0; i--) {
    const raw = definition.steps[i].idl;
    if (raw === undefined) continue;
    return callable(raw);
  }
  return undefined;
};

const log = createLogger("tutorial-conversation:shipped-idl");

/** One parse per shipped string, so every read gets the same object */
const parsed = new Map<string, Idl | undefined>();

const callable = (raw: string): Idl | undefined => {
  if (parsed.has(raw)) return parsed.get(raw);
  let idl: Idl | undefined;
  try {
    const reading = readIdl(JSON.parse(raw));
    idl = reading.kind === "refused" ? undefined : reading.idl;
    if (!idl) log.warn("A tutorial ships an IDL the client cannot call with");
  } catch (e) {
    // `tutorial:check` refuses a string that does not parse
    log.warn("A tutorial ships an IDL that does not parse", {
      context: { error: String(e) },
    });
    idl = undefined;
  }
  parsed.set(raw, idl);
  return idl;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  // sha256("global:<name>")[..8]: a 1.x IDL with any other is refused
  const DISCRIMINATORS: Record<string, number[]> = {
    hello: [149, 118, 59, 220, 196, 127, 161, 179],
    grow: [1, 21, 159, 221, 109, 244, 39, 40],
  };

  const v1 = (...names: string[]) =>
    JSON.stringify({
      address: "11111111111111111111111111111111",
      metadata: { name: "p", version: "0.1.0", spec: "0.1.0" },
      instructions: names.map((name) => ({
        name,
        discriminator: DISCRIMINATORS[name],
        accounts: [],
        args: [],
      })),
    });

  const definitionWith = (...idls: (string | undefined)[]) =>
    ({
      steps: idls.map((idl, i) =>
        idl ? { id: `s${i}`, idl } : { id: `s${i}` }
      ),
    } as unknown as TutorialDefinition);

  const at = (stepId: string): Cursor => ({
    kind: "step",
    stepId,
    beat: 0,
    fail: false,
  });

  const names = (idl: Idl | undefined) =>
    idl?.instructions.map((ix) => ix.name);

  describe("features/tutorial-conversation/model/shipped-idl", () => {
    const d = definitionWith(v1("hello"), undefined, v1("hello", "grow"));

    it("reads the latest IDL at or before the step", () => {
      expect(names(shippedIdl(d, at("s0")))).toEqual(["hello"]);
      expect(names(shippedIdl(d, at("s1")))).toEqual(["hello"]);
      expect(names(shippedIdl(d, at("s2")))).toEqual(["hello", "grow"]);
    });

    it("reads the last on the finish card, and none on the intro", () => {
      expect(names(shippedIdl(d, { kind: "finished" }))).toEqual([
        "hello",
        "grow",
      ]);
      expect(shippedIdl(d, { kind: "intro" })).toBeUndefined();
    });

    it("has none for a tutorial that ships none, or one that does not read", () => {
      expect(shippedIdl(definitionWith(undefined), at("s0"))).toBeUndefined();
      expect(shippedIdl(definitionWith("{}"), at("s0"))).toBeUndefined();
    });

    it("hands back the same object on every read", () => {
      expect(shippedIdl(d, at("s0"))).toBe(shippedIdl(d, at("s1")));
    });
  });
}
