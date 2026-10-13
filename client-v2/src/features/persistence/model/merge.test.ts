// `@types/mocha` also declares a global `it`, without `each`
import { describe, expect, it } from "vitest";

import { clearFailures, getFailures } from "./diagnostics";
import {
  keepLocalKeypair,
  merge3,
  planMerge,
  PROGRAM_INFO_PATH,
  settleConflicts,
  baseAfterMerge,
} from "./merge";
import type { Chunk, FileConflict, Merge3, MergeInput } from "./merge";

const lines = (...xs: string[]) => xs.join("\n");

/** One pane of the view: every settled line, and `side`'s lines of each hunk */
const join = (chunks: Chunk[], side: "base" | "ours" | "theirs") =>
  chunks
    .flatMap((chunk) => (chunk.kind === "settled" ? chunk.lines : chunk[side]))
    .join("\n");

const clean = (text: string): Merge3 => ({ kind: "clean", text });

/** The chunks of a merge that did not come out clean */
const chunksOf = (merged: Merge3): Chunk[] => {
  if (merged.kind !== "conflict") throw new Error("merged cleanly");
  return merged.chunks;
};

describe("merge3", () => {
  const base = lines("a", "b", "c", "d", "e", "");

  it("takes the one side that changed", () => {
    const edited = lines("a", "B", "c", "d", "e", "");
    expect(merge3(base, edited, base)).toEqual(clean(edited));
    expect(merge3(base, base, edited)).toEqual(clean(edited));
  });

  it("merges edits to lines far apart", () => {
    expect(
      merge3(
        base,
        lines("A", "b", "c", "d", "e", ""),
        lines("a", "b", "c", "d", "E", "")
      )
    ).toEqual(clean(lines("A", "b", "c", "d", "E", "")));
  });

  it("merges an insertion with a deletion elsewhere", () => {
    expect(
      merge3(
        base,
        lines("x", "a", "b", "c", "d", "e", ""),
        lines("a", "b", "c", "e", "")
      )
    ).toEqual(clean(lines("x", "a", "b", "c", "e", "")));
  });

  it("accepts the same edit made on both sides", () => {
    const same = lines("a", "B", "c", "d", "e", "");
    expect(merge3(base, same, same)).toEqual(clean(same));
    // The same change inside a group that also holds a one-sided one is
    // still a group both sides touched
    expect(
      merge3(
        base,
        lines("A", "B", "c", "d", "e", ""),
        lines("a", "B", "c", "d", "e", "")
      ).kind
    ).toBe("conflict");
  });

  it("accepts the same edit made on both sides beside a one-sided edit far away", () => {
    expect(
      merge3(
        base,
        lines("a", "B", "c", "d", "E", ""),
        lines("a", "B", "c", "d", "e", "")
      )
    ).toEqual(clean(lines("a", "B", "c", "d", "E", "")));
  });

  it("returns the lines both sides changed as a conflict between settled ones", () => {
    expect(
      merge3(
        base,
        lines("a", "mine", "c", "d", "e", ""),
        lines("a", "theirs", "c", "d", "e", "")
      )
    ).toEqual({
      kind: "conflict",
      chunks: [
        { kind: "settled", lines: ["a"] },
        { kind: "conflict", base: ["b"], ours: ["mine"], theirs: ["theirs"] },
        { kind: "settled", lines: ["c", "d", "e", ""] },
      ],
    });
  });

  it("treats edits to adjacent lines as one conflict, the way git does", () => {
    expect(
      merge3(
        base,
        lines("a", "B", "c", "d", "e", ""),
        lines("a", "b", "C", "d", "e", "")
      )
    ).toEqual({
      kind: "conflict",
      chunks: [
        { kind: "settled", lines: ["a"] },
        {
          kind: "conflict",
          base: ["b", "c"],
          ours: ["B", "c"],
          theirs: ["b", "C"],
        },
        { kind: "settled", lines: ["d", "e", ""] },
      ],
    });
  });

  it("settles every change only one side made, in one chunk with the lines around it", () => {
    // The other device's `A` is in all three panes, so the view asks only
    // about `d`
    expect(
      merge3(
        base,
        lines("a", "b", "c", "mine", "e", ""),
        lines("A", "b", "c", "theirs", "e", "")
      )
    ).toEqual({
      kind: "conflict",
      chunks: [
        {
          kind: "settled",
          lines: ["A", "b", "c"],
          changes: [{ start: 0, count: 1, by: "theirs" }],
        },
        { kind: "conflict", base: ["d"], ours: ["mine"], theirs: ["theirs"] },
        { kind: "settled", lines: ["e", ""] },
      ],
    });
  });

  describe("says which settled lines a side changed", () => {
    /** The settled chunks' changes, in order */
    const changesOf = (b: string, o: string, t: string) =>
      chunksOf(merge3(b, o, t)).map((chunk) =>
        chunk.kind === "settled" ? chunk.changes : "conflict"
      );
    const mid = lines("a", "b", "c", "d", "e", "f", "g");

    it("this device's change", () => {
      expect(
        changesOf(
          mid,
          lines("a", "mine", "c", "d", "E1", "E2", "f", "g"),
          lines("a", "theirs", "c", "d", "e", "f", "g")
        )
      ).toEqual([undefined, "conflict", [{ start: 2, count: 2, by: "ours" }]]);
    });

    it("the other device's change", () => {
      expect(
        changesOf(
          mid,
          lines("a", "b", "c", "d", "e", "mine", "g"),
          lines("A", "b", "c", "d", "e", "theirs", "g")
        )
      ).toEqual([
        [{ start: 0, count: 1, by: "theirs" }],
        "conflict",
        undefined,
      ]);
    });

    it("the same change made on both, and one side's beside it", () => {
      expect(
        changesOf(
          mid,
          lines("S", "b", "c", "mine", "e", "F", "g"),
          lines("S", "b", "c", "theirs", "e", "f", "g")
        )
      ).toEqual([
        [{ start: 0, count: 1, by: "both" }],
        "conflict",
        [{ start: 1, count: 1, by: "ours" }],
      ]);
    });

    it("a deletion, as no lines before the line after it", () => {
      // Nothing is left of `b` to mark; where it was is still a change
      expect(
        changesOf(
          mid,
          lines("a", "c", "d", "e", "mine", "g"),
          lines("a", "b", "c", "d", "e", "theirs", "g")
        )
      ).toEqual([[{ start: 1, count: 0, by: "ours" }], "conflict", undefined]);
    });

    it("points at the lines each side's change put in the chunk", () => {
      const o = lines("a", "b", "d", "e", "mine", "g", "x");
      const t = lines("A", "b", "c", "d", "e", "theirs", "g");
      const chunks = chunksOf(merge3(mid, o, t));
      expect(join(chunks, "base")).toBe(
        lines("A", "b", "d", "e", "f", "g", "x")
      );
      const [before, , after] = chunks;
      expect(before).toEqual({
        kind: "settled",
        lines: ["A", "b", "d", "e"],
        changes: [
          { start: 0, count: 1, by: "theirs" },
          { start: 2, count: 0, by: "ours" },
        ],
      });
      expect(after).toEqual({
        kind: "settled",
        lines: ["g", "x"],
        changes: [{ start: 1, count: 1, by: "ours" }],
      });
    });
  });

  it("tells a deleted line from one replaced by a blank line", () => {
    const five = "a\nb\nc\nd\ne";
    const deleted = "a\nc\nd\nE";
    const blanked = "a\n\nc\nd\ne";
    expect(chunksOf(merge3(five, deleted, blanked))).toEqual([
      { kind: "settled", lines: ["a"] },
      { kind: "conflict", base: ["b"], ours: [], theirs: [""] },
      {
        kind: "settled",
        lines: ["c", "d", "E"],
        changes: [{ start: 2, count: 1, by: "ours" }],
      },
    ]);
    expect(merge3(five, blanked, deleted).kind).toBe("conflict");
  });

  it("tells a deleted final line from an emptied one", () => {
    expect(chunksOf(merge3("a\nb", "a\n", "a"))).toEqual([
      { kind: "settled", lines: ["a"] },
      { kind: "conflict", base: ["b"], ours: [""], theirs: [] },
    ]);
    expect(merge3("a\nb", "a", "a\n").kind).toBe("conflict");
  });

  it("keeps a file without a final newline without one", () => {
    const chunks = chunksOf(merge3("a\nb", "a\nmine", "a\ntheirs"));
    expect(chunks).toEqual([
      { kind: "settled", lines: ["a"] },
      { kind: "conflict", base: ["b"], ours: ["mine"], theirs: ["theirs"] },
    ]);
    expect(join(chunks, "ours")).toBe("a\nmine");
  });

  it("keeps CRLF endings byte for byte", () => {
    const crlf = "a\r\nb\r\nc\r\nd\r\ne";
    expect(
      merge3(crlf, "A\r\nb\r\nc\r\nd\r\ne", "a\r\nb\r\nc\r\nd\r\nE")
    ).toEqual(clean("A\r\nb\r\nc\r\nd\r\nE"));

    const chunks = chunksOf(
      merge3("a\r\nb\r\nc", "a\r\nB\r\nc", "a\r\nX\r\nc")
    );
    expect(chunks).toEqual([
      { kind: "settled", lines: ["a\r"] },
      { kind: "conflict", base: ["b\r"], ours: ["B\r"], theirs: ["X\r"] },
      { kind: "settled", lines: ["c"] },
    ]);
    expect(join(chunks, "theirs")).toBe("a\r\nX\r\nc");
  });

  describe("the panes are joins of the chunks", () => {
    /**
     * Cases where every change either side made is inside a conflict, so a
     * side's pane is that side's file exactly. Where one side also made a
     * change nobody else touched, that change is settled and so in every
     * pane -- see the cases below.
     */
    const exact: Array<[string, string, string, string]> = [
      ["one line", "a\nb\nc\n", "a\nmine\nc\n", "a\ntheirs\nc\n"],
      ["adjacent lines", "a\nb\nc\nd\n", "a\nB\nc\nd\n", "a\nb\nC\nd\n"],
      [
        "two conflicts",
        "a\nb\nc\nd\ne\n",
        "M\nb\nc\nd\nM\n",
        "T\nb\nc\nd\nT\n",
      ],
      ["no final newline", "a\nb", "a\nmine", "a\ntheirs"],
      ["a final newline added and removed", "a\nb", "a\nb\n", "a\nB"],
      ["CRLF", "a\r\nb\r\nc\r\n", "a\r\nB\r\nc\r\n", "a\r\nX\r\nc\r\n"],
      ["mixed endings", "a\r\nb\nc", "a\r\nB\r\nc", "a\r\nb\nC"],
      ["an emptied file", "a\nb\n", "", "a\nB\n"],
      ["from empty", "", "mine\n", "theirs\n"],
      ["a delete against an edit", "a\nb\nc\n", "a\nc\n", "a\nB\nc\n"],
      ["an insertion at one spot", "a\nb\n", "a\nmine\nb\n", "a\ntheirs\nb\n"],
      ["blank against deleted", "a\nb\nc", "a\n\nc", "a\nc"],
      ["a whole rewrite", "a\nb\nc", "x\ny", "p\nq\nr\ns"],
    ];

    for (const [name, b, o, t] of exact) {
      it(`rebuilds all three files exactly: ${name}`, () => {
        const chunks = chunksOf(merge3(b, o, t));
        expect(join(chunks, "base")).toBe(b);
        expect(join(chunks, "ours")).toBe(o);
        expect(join(chunks, "theirs")).toBe(t);
      });
    }

    /** Each side's pane carries the other side's settled change too */
    const settled: Array<[string, string, string, string, string, string]> = [
      [
        "theirs changed a line far away",
        "a\nb\nc\nd\ne\n",
        "a\nb\nc\nmine\ne\n",
        "A\nb\nc\ntheirs\ne\n",
        "A\nb\nc\nmine\ne\n",
        "A\nb\nc\nd\ne\n",
      ],
      [
        "ours deleted a line far away",
        "a\nb\nc\nd\ne",
        "b\nc\nmine\ne",
        "a\nb\nc\ntheirs\ne",
        "b\nc\nmine\ne",
        "b\nc\nd\ne",
      ],
      [
        "both made the same change far away",
        "a\nb\nc\nd\ne\n",
        "S\nb\nc\nmine\ne\n",
        "S\nb\nc\ntheirs\ne\n",
        "S\nb\nc\nmine\ne\n",
        "S\nb\nc\nd\ne\n",
      ],
    ];

    for (const [name, b, o, t, ours, result] of settled) {
      it(`applies what only one side changed in every pane: ${name}`, () => {
        const chunks = chunksOf(merge3(b, o, t));
        expect(join(chunks, "ours")).toBe(ours);
        expect(join(chunks, "base")).toBe(result);
      });
    }

    /** Settled lines run together: one chunk between two conflicts */
    const coalesced = (name: string, b: string, o: string, t: string) =>
      it(`never has two settled chunks in a row, or an empty one: ${name}`, () => {
        const chunks = chunksOf(merge3(b, o, t));
        chunks.forEach((chunk, k) => {
          if (chunk.kind !== "settled") return;
          expect(chunk.lines.length).toBeGreaterThan(0);
          expect(chunks[k + 1]?.kind).not.toBe("settled");
        });
      });
    for (const [name, b, o, t] of exact) coalesced(name, b, o, t);
    for (const [name, b, o, t] of settled) coalesced(name, b, o, t);
  });
});

describe("planMerge", () => {
  const h = (content: string) => `h(${content})`;
  const input = (
    base: Record<string, string>,
    local: Record<string, string>,
    server: Record<string, string>,
    baseContents: Record<string, string> = {}
  ): MergeInput => {
    const hashes = (files: Record<string, string>) =>
      Object.fromEntries(Object.entries(files).map(([p, c]) => [p, h(c)]));
    return {
      base: hashes(base),
      baseContents: Object.fromEntries(
        Object.entries(baseContents).map(([p, c]) => [
          p,
          { hash: h(c), content: c },
        ])
      ),
      local,
      localHashes: hashes(local),
      server,
      serverHashes: hashes(server),
    };
  };

  it("takes each side's changes to different files", () => {
    const plan = planMerge(
      input({ a: "1", b: "1" }, { a: "2", b: "1" }, { a: "1", b: "3" })
    );
    expect(plan).toEqual({ files: { a: "2", b: "3" }, conflicts: [] });
  });

  it("carries a delete from either side", () => {
    const plan = planMerge(input({ a: "1", b: "1" }, { b: "1" }, { a: "1" }));
    expect(plan).toEqual({ files: {}, conflicts: [] });
  });

  it("keeps a file added on one side only", () => {
    expect(planMerge(input({}, { a: "1" }, {})).files).toEqual({ a: "1" });
  });

  it("merges lines within a file when the base content is known", () => {
    const base = "a\nb\nc\nd\ne";
    const plan = planMerge(
      input(
        { f: base },
        { f: "A\nb\nc\nd\ne" },
        { f: "a\nb\nc\nd\nE" },
        { f: base }
      )
    );
    expect(plan).toEqual({ files: { f: "A\nb\nc\nd\nE" }, conflicts: [] });
  });

  it("carries the lines both sides changed, pinned to both copies", () => {
    const base = "a\nb\nc\n";
    const plan = planMerge(
      input(
        { f: base, g: "1" },
        { f: "a\nmine\nc\n", g: "2" },
        { f: "a\ntheirs\nc\n", g: "1" },
        { f: base }
      )
    );
    const expected: FileConflict[] = [
      {
        kind: "lines",
        path: "f",
        chunks: [
          { kind: "settled", lines: ["a"] },
          {
            kind: "conflict",
            base: ["b"],
            ours: ["mine"],
            theirs: ["theirs"],
          },
          { kind: "settled", lines: ["c", ""] },
        ],
        localHash: "h(a\nmine\nc\n)",
        serverHash: "h(a\ntheirs\nc\n)",
      },
    ];
    expect(plan).toEqual({ files: { g: "2" }, conflicts: expected });
  });

  it("asks about a whole file whose base content was never captured", () => {
    const plan = planMerge(input({ f: "a" }, { f: "b" }, { f: "c" }));
    const expected: FileConflict[] = [
      {
        kind: "whole",
        path: "f",
        local: "b",
        server: "c",
        localHash: "h(b)",
        serverHash: "h(c)",
      },
    ];
    expect(plan.conflicts).toEqual(expected);
    expect(plan.files).toEqual({});
  });

  it("does not trust base content that belongs to another agreement", () => {
    const i = input({ f: "a\nb\nc" }, { f: "A\nb\nc" }, { f: "a\nb\nC" });
    i.baseContents = { f: { hash: "h(something else)", content: "a\nb\nc" } };
    const expected: FileConflict[] = [
      {
        kind: "whole",
        path: "f",
        local: "A\nb\nc",
        server: "a\nb\nC",
        localHash: "h(A\nb\nc)",
        serverHash: "h(a\nb\nC)",
      },
    ];
    expect(planMerge(i).conflicts).toEqual(expected);
  });

  it("asks about a whole file deleted here and edited on the other side", () => {
    const plan = planMerge(input({ f: "a" }, {}, { f: "b" }, { f: "a" }));
    const expected: FileConflict[] = [
      { kind: "whole", path: "f", server: "b", serverHash: "h(b)" },
    ];
    expect(plan.conflicts).toEqual(expected);
    expect(plan.conflicts[0]).not.toHaveProperty("local");
    expect(plan.conflicts[0]).not.toHaveProperty("localHash");
  });

  it("asks about a whole file deleted on the other side and edited here", () => {
    const plan = planMerge(input({ f: "a" }, { f: "b" }, {}, { f: "a" }));
    const expected: FileConflict[] = [
      { kind: "whole", path: "f", local: "b", localHash: "h(b)" },
    ];
    expect(plan.conflicts).toEqual(expected);
    expect(plan.conflicts[0]).not.toHaveProperty("server");
    expect(plan.conflicts[0]).not.toHaveProperty("serverHash");
  });

  it("asks about a whole file both sides added differently", () => {
    const expected: FileConflict[] = [
      {
        kind: "whole",
        path: "f",
        local: "a",
        server: "b",
        localHash: "h(a)",
        serverHash: "h(b)",
      },
    ];
    expect(planMerge(input({}, { f: "a" }, { f: "b" })).conflicts).toEqual(
      expected
    );
  });

  describe("line endings the resolve view cannot show line by line", () => {
    /** Both sides changed the middle line, each copy written as given */
    const conflictOf = (base: string, mine: string, theirs: string) =>
      planMerge(input({ f: base }, { f: mine }, { f: theirs }, { f: base }))
        .conflicts[0];

    it.each([
      [
        "one copy mixes \\r\\n and \\n",
        "a\r\nb\r\nc",
        "a\r\nmine\nc",
        "a\r\ntheirs\r\nc",
      ],
      [
        "the copies use different ones",
        "a\nb\nc",
        "a\r\nmine\r\nc",
        "a\ntheirs\nc",
      ],
      [
        "a copy breaks lines with a lone \\r",
        "a\rb\nc",
        "a\rmine\nc",
        "a\rtheirs\nc",
      ],
    ])("asks about the whole file when %s", (_, base, mine, theirs) => {
      const expected: FileConflict = {
        kind: "whole",
        path: "f",
        local: mine,
        server: theirs,
        localHash: h(mine),
        serverHash: h(theirs),
      };
      expect(conflictOf(base, mine, theirs)).toEqual(expected);
    });

    it("still splits a file that uses \\r\\n throughout", () => {
      const crlf = (s: string) => s.split("\n").join("\r\n");
      expect(
        conflictOf(crlf("a\nb\nc"), crlf("a\nmine\nc"), crlf("a\ntheirs\nc"))
          .kind
      ).toBe("lines");
    });

    it("still merges such a file when nothing overlaps", () => {
      const plan = planMerge(
        input(
          { f: "a\r\nb\nc\nd\ne" },
          { f: "A\r\nb\nc\nd\ne" },
          { f: "a\r\nb\nc\nd\nE" },
          { f: "a\r\nb\nc\nd\ne" }
        )
      );
      expect(plan).toEqual({
        files: { f: "A\r\nb\nc\nd\nE" },
        conflicts: [],
      });
    });
  });

  it("lets the server win a generated workspace file without asking", () => {
    const keypair = ".workspace/program-info.json";
    const plan = planMerge(
      input({ [keypair]: "0" }, { [keypair]: "local" }, { [keypair]: "server" })
    );
    expect(plan).toEqual({ files: { [keypair]: "server" }, conflicts: [] });
  });

  it("keeps this device's keypair when the server's changed copy has none", () => {
    const plan = planMerge(
      input(
        { [PROGRAM_INFO_PATH]: info({ kp: null }) },
        { [PROGRAM_INFO_PATH]: info({ kp: DEVICE_KP }) },
        { [PROGRAM_INFO_PATH]: info({ kp: null, idl: "theirs" }) }
      )
    );
    expect(plan.conflicts).toEqual([]);
    expect(JSON.parse(plan.files[PROGRAM_INFO_PATH])).toEqual({
      ...JSON.parse(info({ kp: null, idl: "theirs" })),
      kp: DEVICE_KP,
    });
  });

  it("still lets the server's keypair win over a different one here", () => {
    const theirs = info({ kp: ACCOUNT_KP, idl: "theirs" });
    const plan = planMerge(
      input(
        { [PROGRAM_INFO_PATH]: info({ kp: null }) },
        { [PROGRAM_INFO_PATH]: info({ kp: DEVICE_KP }) },
        { [PROGRAM_INFO_PATH]: theirs }
      )
    );
    expect(plan).toEqual({
      files: { [PROGRAM_INFO_PATH]: theirs },
      conflicts: [],
    });
  });
});

/** Two different 64-byte secret keys, in the array form `PgProgramInfo` stores */
const DEVICE_KP = Array.from({ length: 64 }, (_, i) => i);
const ACCOUNT_KP = Array.from({ length: 64 }, (_, i) => 255 - i);

/** A `program-info.json` as `PgProgramInfo` serialises it */
const info = (fields: { kp: number[] | null; idl?: string }) =>
  JSON.stringify({
    uuid: "build-uuid",
    idl: fields.idl ?? null,
    kp: fields.kp,
    customPk: null,
    lastBuildFailed: false,
  });

describe("keepLocalKeypair", () => {
  beforeEach(clearFailures);
  afterEach(clearFailures);

  it("carries this device's keypair into an account copy that has none", () => {
    const account = info({ kp: null, idl: "theirs" });
    const kept = keepLocalKeypair(info({ kp: DEVICE_KP }), account);
    // Every other field is the account's
    expect(JSON.parse(kept!)).toEqual({
      ...JSON.parse(account),
      kp: DEVICE_KP,
    });
  });

  it("carries it into an account copy with no kp field at all", () => {
    const account = JSON.stringify({ uuid: "theirs" });
    expect(
      JSON.parse(keepLocalKeypair(info({ kp: DEVICE_KP }), account)!)
    ).toEqual({ uuid: "theirs", kp: DEVICE_KP });
  });

  it("carries only the keypair when the account has no copy at all", () => {
    expect(
      JSON.parse(keepLocalKeypair(info({ kp: DEVICE_KP }), undefined)!)
    ).toEqual({ kp: DEVICE_KP });
  });

  it("keeps the account's copy when both hold different keypairs", () => {
    const account = info({ kp: ACCOUNT_KP });
    expect(keepLocalKeypair(info({ kp: DEVICE_KP }), account)).toBe(account);
  });

  it("keeps the account's copy when this device has no keypair", () => {
    const account = info({ kp: null, idl: "theirs" });
    expect(keepLocalKeypair(info({ kp: null }), account)).toBe(account);
    expect(keepLocalKeypair(undefined, account)).toBe(account);
    expect(keepLocalKeypair(undefined, undefined)).toBeUndefined();
    expect(keepLocalKeypair(info({ kp: null }), undefined)).toBeUndefined();
    // Nothing is wrong with a project that was never built
    expect(getFailures()).toEqual([]);
  });

  it("keeps the account's copy, and says so, when either side is not JSON", () => {
    const account = info({ kp: null });
    expect(keepLocalKeypair("{not json", account)).toBe(account);
    expect(keepLocalKeypair(info({ kp: DEVICE_KP }), "{not json")).toBe(
      "{not json"
    );
    expect(getFailures()).toHaveLength(2);
  });

  it("keeps the account's copy when either side is not the stored shape", () => {
    const account = info({ kp: null });
    expect(keepLocalKeypair(JSON.stringify([1, 2]), account)).toBe(account);
    expect(keepLocalKeypair(JSON.stringify({ kp: "abc" }), account)).toBe(
      account
    );
    expect(keepLocalKeypair(JSON.stringify({ kp: [1, 2, 3] }), account)).toBe(
      account
    );
    expect(keepLocalKeypair(info({ kp: DEVICE_KP }), "null")).toBe("null");
    expect(keepLocalKeypair(info({ kp: DEVICE_KP }), "[]")).toBe("[]");
  });
});

describe("settling", () => {
  const conflicts: FileConflict[] = [
    {
      kind: "whole",
      path: "b",
      local: "local b",
      server: "server b",
      localHash: "hlb",
      serverHash: "hsb",
    },
    { kind: "whole", path: "c", server: "server c", serverHash: "hsc" },
  ];
  const plan = { files: { a: "merged" }, conflicts };
  const local = { a: "l", b: "local b" };
  const server = { a: "s", b: "server b", c: "server c" };

  it("fills conflicted files from the side the user picked", () => {
    expect(settleConflicts(plan, "local", local, server)).toEqual({
      a: "merged",
      b: "local b",
    });
    expect(settleConflicts(plan, "server", local, server)).toEqual({
      a: "merged",
      b: "server b",
      c: "server c",
    });
  });

  it("fills conflicted files with the content the user resolved, deleting on null", () => {
    expect(
      settleConflicts(
        plan,
        {
          b: { content: "resolved b", localHash: "hlb", serverHash: "hsb" },
          c: { content: null, serverHash: "hsc" },
          // Not in conflict: what merged stays merged
          a: { content: "ignored" },
        },
        local,
        server
      )
    ).toEqual({ a: "merged", b: "resolved b" });
  });

  it("refuses a resolution that leaves a conflicted file unanswered", () => {
    // Settling without it would drop the file, which reads as a delete
    expect(() =>
      settleConflicts(
        plan,
        { b: { content: "resolved b", localHash: "hlb", serverHash: "hsb" } },
        local,
        server
      )
    ).toThrow(/c/);
  });

  it("keeps as base the server's version of every file this device still differs on", () => {
    expect(
      baseAfterMerge(
        { a: "same", b: "mine", d: "new here" },
        { a: "same", b: "theirs", c: "gone here" },
        { a: "ha", b: "hb", c: "hc" }
      )
    ).toEqual({
      b: { hash: "hb", content: "theirs" },
      c: { hash: "hc", content: "gone here" },
    });
  });
});
