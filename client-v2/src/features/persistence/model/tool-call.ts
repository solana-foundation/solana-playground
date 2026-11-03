// A leaf at runtime: it imports the store by type only, and must stay so.
// The store imports this slice, so a value import from the store here would
// close an import cycle the dev build refuses (`CircularDependencyPlugin`).
import { redactKey } from "@/shared/lib/ai";
import type { ToolResultEvent } from "@/shared/lib/ai";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

/**
 * One finished tool call as a later turn needs it (HOO-2425), written by
 * `toToolCallRecord`: the key redacted, every string of the input and the
 * result cut, an input that is not an object wrapped in one, and an input
 * still too long replaced by a note of its size. The SDK's call id is not
 * kept: a replay mints its own, since one backend's ids are not valid on
 * another.
 */
export interface ToolCallRecord {
  name: string;
  /** Always a plain object: Anthropic refuses a `tool_use` whose input is not one */
  input: Record<string, unknown>;
  /** What the model read: the tool's text, or its message when it threw */
  output: string;
  failed?: true;
}

/**
 * Caps on what one record keeps, in characters. A result is what costs: a
 * file read whole. The live project goes with every turn anyway
 * (`describeProject`), so a cut result loses little. A thread is pushed in one
 * request of at most 2,000,000 bytes (`api/conversations.mjs`) and keeps 200
 * items: 200 records at these caps are about 1.2 MB of mostly-ASCII text, but
 * text of three-byte characters can pass the limit, as long replies already
 * can. How many records a replay sends is bounded separately
 * (`REPLAY_CALL_BUDGET` in `replay.ts`).
 */
const RESULT_CAP = 4_000;
const INPUT_STRING_CAP = 1_000;
const INPUT_CAP = 2_000;

/** Said in place of an empty result: Anthropic refuses an empty text block */
const NO_OUTPUT = "(no output)";

/**
 * What every backend accepts as a tool's name in a replayed call: Anthropic's
 * and OpenAI's characters, starting as Gemini requires
 */
export const TOOL_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/;

/**
 * A tool's name as a replay can send it. The SDK reports a call to a tool
 * that does not exist with the name the model made up (`functions.read`);
 * stored as it is, every later replay of the thread would be refused.
 */
const replayableName = (name: string) => {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!safe) return "tool";
  return (/^[a-zA-Z_]/.test(safe) ? safe : `_${safe}`).slice(0, 64);
};

/** A surrogate with no partner, which JSON escapes and Postgres refuses */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Text Postgres takes in a `jsonb` row: no NUL and no lone surrogate. Either
 * one fails the server's insert of the whole thread, so one binary read would
 * stop the thread syncing for good.
 */
const storable = (text: string) =>
  text.replaceAll("\u0000", "").replace(LONE_SURROGATE, "\uFFFD");

/**
 * `text` made storable and cut to `cap`, ending with how much was cut, so
 * the model knows. The cut never splits a surrogate pair.
 */
const cut = (raw: string, cap: number) => {
  const text = storable(raw);
  if (text.length <= cap) return text;
  const end = /[\uD800-\uDBFF]/.test(text[cap - 1]) ? cap - 1 : cap;
  return `${text.slice(0, end)} … [${text.length - end} characters cut]`;
};

/**
 * Every string in a call's input redacted and cut, the shape kept, so
 * storing the record never throws on what a tool was called with: a value
 * with `toJSON` (a `Date`) is stored as that, a BigInt as its digits, a
 * function or symbol is dropped, and an object inside itself is replaced by
 * `[circular]`.
 */
const capInputValueWith =
  (call: { apiKey: string | undefined; seen: WeakSet<object> }) =>
  (value: unknown): unknown => {
    const { apiKey, seen } = call;
    const capInputValue = capInputValueWith(call);
    if (typeof value === "string") {
      return cut(redactKey(value, apiKey), INPUT_STRING_CAP);
    }
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function" || typeof value === "symbol") {
      return undefined;
    }
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[circular]";
    const { toJSON } = value as { toJSON?: unknown };
    if (typeof toJSON === "function") {
      return capInputValue(toJSON.call(value));
    }
    // Ancestors only: the same object twice side by side is not a cycle
    seen.add(value);
    const capped = Array.isArray(value)
      ? value.map((v) => capInputValue(v))
      : Object.fromEntries(
          Object.entries(value).map(([k, v]) => [storable(k), capInputValue(v)])
        );
    seen.delete(value);
    return capped;
  };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A call's input as stored. An input that is not an object (the raw text of
 * arguments the model got wrong) is wrapped as `{ value }`, so the replayed
 * call stays one Anthropic accepts.
 */
const capInput = (
  input: unknown,
  apiKey: string | undefined
): Record<string, unknown> => {
  const capped = capInputValueWith({ apiKey, seen: new WeakSet() })(input);
  let object: Record<string, unknown> = {};
  if (isPlainObject(capped)) object = capped;
  else if (capped !== undefined) object = { value: capped };
  const size = JSON.stringify(object).length;
  return size > INPUT_CAP ? { omitted: `${size} characters of input` } : object;
};

/** Whether an item is a stored call rather than a marker the thread draws */
export const isToolCallRecord = (
  item: ChatItem
): item is ChatItem & { kind: "tool"; call: ToolCallRecord } =>
  item.kind === "tool" && item.call !== undefined;

/** A tool's finished call as the thread stores it */
export const toToolCallRecord = (
  result: Pick<ToolResultEvent, "toolName" | "input" | "output" | "failed">,
  apiKey: string | undefined
): ToolCallRecord => {
  const output = cut(redactKey(result.output, apiKey), RESULT_CAP);
  const call: ToolCallRecord = {
    name: replayableName(result.toolName),
    input: capInput(result.input, apiKey),
    output: output.trim() ? output : NO_OUTPUT,
  };
  if (result.failed) call.failed = true;
  return call;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/persistence/model/tool-call", () => {
    const recordWith = (output: string) => (input: unknown) =>
      toToolCallRecord(
        { toolName: "probe", input, output, failed: false },
        undefined
      );
    const record = recordWith("ok");

    it("wraps an input that is not an object, so Anthropic takes the replay", () => {
      expect(record('{"path": "src/li').input).toEqual({
        value: '{"path": "src/li',
      });
      expect(record(undefined).input).toEqual({});
    });

    it("stores an input holding a BigInt or a cycle instead of throwing", () => {
      const cyclic: Record<string, unknown> = { n: BigInt(7) };
      cyclic.self = cyclic;

      expect(record(cyclic).input).toEqual({ n: "7", self: "[circular]" });
    });

    it("says there was no output rather than storing an empty one", () => {
      expect(recordWith("")({}).output).toBe(NO_OUTPUT);
      expect(recordWith("  ")({}).output).toBe(NO_OUTPUT);
    });

    it("cuts nothing at exactly the cap", () => {
      expect(recordWith("x".repeat(4_000))({}).output).toBe("x".repeat(4_000));
      expect(record({ s: "y".repeat(1_000) }).input).toEqual({
        s: "y".repeat(1_000),
      });
    });

    it("stores no NUL and no lone surrogate, which Postgres refuses", () => {
      const { output, input } = recordWith("x\u0000\uDE00y")({
        s: "a\u0000b\uD83D",
      });

      expect(output).toBe("x\uFFFDy");
      expect(input).toEqual({ s: "ab\uFFFD" });
    });

    it("never cuts a surrogate pair in half", () => {
      const output = recordWith(`${"x".repeat(3_999)}😀😀`)({}).output;

      expect(output.startsWith(`${"x".repeat(3_999)} … [`)).toBe(true);
      expect(output).toBe(`${"x".repeat(3_999)} … [4 characters cut]`);
    });

    it("keeps an object met twice that is not a cycle, and a Date as text", () => {
      const shared = { a: 1 };
      const at = new Date("2026-11-03T00:00:00.000Z");

      expect(record({ x: shared, y: shared, at }).input).toEqual({
        x: { a: 1 },
        y: { a: 1 },
        at: "2026-11-03T00:00:00.000Z",
      });
    });

    it("stores a made-up tool name as one a replay can send", () => {
      const { name } = toToolCallRecord(
        {
          toolName: "functions.read file",
          input: {},
          output: "Not a tool",
          failed: true,
        },
        undefined
      );

      expect(name).toBe("functions_read_file");
      expect(TOOL_NAME.test(name)).toBe(true);
    });

    it("starts a made-up name with a letter or underscore, as Gemini requires", () => {
      expect(record({}).name).toBe("probe");
      const { name } = toToolCallRecord(
        { toolName: "1inch-quote", input: {}, output: "x", failed: true },
        undefined
      );

      expect(name).toBe("_1inch-quote");
      expect(TOOL_NAME.test(name)).toBe(true);
    });

    it("strips NUL from an input's keys, as from its values", () => {
      expect(record({ "a\u0000b": 1 }).input).toEqual({ ab: 1 });
    });

    it("redacts the key from a result", () => {
      const key = "sk-test-output-0123456789";
      const { output } = toToolCallRecord(
        { toolName: "probe", input: {}, output: `got ${key}`, failed: false },
        key
      );

      expect(output).not.toContain(key);
    });

    it("redacts the key inside a nested input", () => {
      const key = "sk-test-nested-0123456789";
      const { input } = toToolCallRecord(
        {
          toolName: "probe",
          input: { headers: [{ auth: `Bearer ${key}` }] },
          output: "ok",
          failed: false,
        },
        key
      );

      expect(JSON.stringify(input)).not.toContain(key);
    });
  });
}
