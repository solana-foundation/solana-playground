import type { Ask } from "@/entities/tutorial";

/**
 * Where a lesson block lands in a file, and how a file is read for it. Ported
 * from the prototype's `check.ts` and `landing.ts`
 * (`design-system/src/prototype/tutorial-v2`): the rules of `insertBlock`
 * are the design's, and the editor's landing line (task 2.2) and the
 * question card's "Type it myself" (task 3.5) draw the same dry run.
 */

const DECLARE = /(declare_id!\(\s*")[^"]*("\s*\))/g;

/** The file with its program id in `declare_id!`, as Playground writes it in */
export const withId = (code: string, id: string) =>
  code.replace(
    DECLARE,
    (_, open: string, close: string) => `${open}${id}${close}`
  );

/** Whitespace goes, and so does the program id: which address `declare_id!`
 * holds is Playground's to fill, never a difference the lesson reads */
const squash = (code: string) => withId(code, "").replace(/\s+/g, "");

/** Whether two versions of a file differ only in whitespace or the program id */
export const sameCode = (a: string, b: string) => squash(a) === squash(b);

// A string first, so a // inside one is not taken for a comment, then either kind of comment
const COMMENT =
  /("(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/** The code without its comments. A comment that spans lines leaves its line
 * breaks behind, so every line keeps its number */
export const uncomment = (code: string) =>
  code.replace(COMMENT, (m, str: string | undefined) =>
    str === undefined ? m.replace(/[^\n]/g, "") : str
  );

/** One line as the lesson compares it: whitespace gone, `pub mod` the same as
 * `mod`, and what `msg!` says up to the writer as long as it fills as many `{}` */
const norm = (line: string) =>
  squash(
    line
      .replace(/\bpub\s+mod\b/g, "mod")
      .replace(
        /msg!\(\s*"((?:[^"\\]|\\.)*)"/g,
        (_, text: string) =>
          `msg!("${"{}".repeat(text.split("{}").length - 1)}"`
      )
  );

const lines = (code: string) => uncomment(code).split("\n").map(norm);

/** Curly quotes as straight ones: a tablet's keyboard curls them as you type */
export const straightQuotes = (code: string) =>
  code.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

/** Whether the file holds a piece of code, judged the way a build is:
 * whitespace, blank lines and comments aside, curly quotes as straight ones,
 * any text in `msg!`. Its lines have to come in a row, in the same order */
export const holds = (file: string, snippet: string): boolean => {
  const want = lines(straightQuotes(snippet)).filter(Boolean);
  if (want.length === 0) return false;
  const have = lines(straightQuotes(file)).filter(Boolean);
  for (let i = 0; i + want.length <= have.length; i++) {
    if (want.every((l, k) => have[i + k] === l)) return true;
  }
  return false;
};

/** A line as "Type it myself" compares it: a trailing semicolon left off or
 * added is no reason to call the answer wrong */
const loose = (line: string) => norm(straightQuotes(line)).replace(/;+$/, "");

/** The 1-based line of the file that holds the answer's key line, or null.
 * A line may say more around it, `const txHash = ` before the call, say */
export const typedKey = (file: string, key: string): number | null => {
  const want = loose(key);
  if (!want) return null;
  const i = uncomment(straightQuotes(file))
    .split("\n")
    .findIndex((l) => loose(l).includes(want));
  return i === -1 ? null : i + 1;
};

/** The one line the learner types for a question: its `key`, or the right
 * option when the options are code */
export const keyOf = (ask: Ask): string | null =>
  ask.key ?? (ask.code ? ask.options[ask.answer] : null);

/** The block with the learner's own words in its `msg!` line, when their
 * typed line has one with as many `{}`: the assistant fills in the rest, it
 * does not change what they wrote */
export const withOwnText = (block: string, typed: string) => {
  const MSG = /msg!\(\s*"((?:[^"\\]|\\.)*)"/;
  const own = straightQuotes(typed).match(MSG)?.[1];
  if (own === undefined) return block;
  return block.replace(MSG, (m, text: string) =>
    text.split("{}").length === own.split("{}").length ? `msg!("${own}"` : m
  );
};

/** Where a lesson block sits in the code the step builds: the first and last
 * line it takes there, 0-based, matched the way `holds` reads code. Null
 * when the block is not part of it */
const placeIn = (
  reference: string[],
  block: string[]
): [number, number] | null => {
  const want = block.filter(Boolean);
  if (want.length === 0) return null;
  const at = reference.map((l, i) => [l, i] as const).filter(([l]) => l !== "");
  for (let i = 0; i + want.length <= at.length; i++) {
    if (want.every((l, k) => at[i + k][0] === l)) {
      return [at[i][1], at[i + want.length - 1][1]];
    }
  }
  return null;
};

/**
 * Where the block goes in the reference, when the file holds only lines the
 * reference or the start know; null when it has to be appended instead
 */
const placement = (
  file: string,
  block: string,
  reference: string | undefined,
  start: string
) => {
  if (!reference) return null;
  const ref = reference.split("\n");
  const refNorm = lines(reference);
  const place = placeIn(refNorm, lines(straightQuotes(block)));
  const mine = lines(straightQuotes(file)).filter(Boolean);
  const known = new Set([...refNorm, ...lines(start)]);
  if (!place || mine.some((l) => !known.has(l))) return null;
  // The block's own text for each reference line it lands on: what `msg!`
  // says is the writer's, and a learner's words must reach the file
  const ownLine = new Map<number, string>();
  const blockRows = block.split("\n");
  const blockNorm = lines(straightQuotes(block));
  let k = 0;
  for (let i = place[0]; i <= place[1]; i++) {
    if (refNorm[i] === "") continue;
    // The block's rows pair with the reference's by the same reading: a
    // comment or a blank line counts in neither
    while (k < blockRows.length && blockNorm[k] === "") k++;
    if (k >= blockRows.length) break;
    ownLine.set(i, blockRows[k++]);
  }
  return { ref, refNorm, place, mine, ownLine };
};

export interface Placed {
  code: string;
  /** The lines the block took, counted from 1 */
  lines: number[];
}

/**
 * The file with a lesson block put in where the step's code has it.
 * `reference` is the code the step builds up to (its target for that file).
 * The file is rebuilt from it, keeping each line the file already has and the
 * block's own, so blocks land in order whatever order they are added in, and
 * a line the block replaces goes. `start` is the file as the step found it:
 * its lines may go, being the ones the step changes. Code neither knows,
 * typed by hand, would be lost that way, so then the block goes at the end
 * instead, with the learner's own lines kept.
 */
export const insertBlock = (
  file: string,
  block: string,
  reference: string | undefined,
  start = ""
): Placed => {
  const append = (): Placed => {
    const head = file.replace(/\s+$/, "");
    const code = head ? `${head}\n\n${block}` : block;
    const from = head ? head.split("\n").length + 2 : 1;
    return { code, lines: block.split("\n").map((_, i) => from + i) };
  };
  const placed = placement(file, block, reference, start);
  if (!placed) return append();
  const { ref, refNorm, place, mine, ownLine } = placed;

  const have = new Set(mine);
  const kept = (i: number) =>
    (i >= place[0] && i <= place[1]) ||
    (refNorm[i] !== "" && have.has(refNorm[i]));
  // A comment goes with the line under it, and a blank line stays only
  // between two kept lines
  const keep = ref.map((_, i) => kept(i));
  const own = ref.map((_, i) => i >= place[0] && i <= place[1]);
  for (let i = ref.length - 2; i >= 0; i--) {
    if (refNorm[i] === "" && ref[i].trim() !== "" && keep[i + 1]) {
      keep[i] = true;
      own[i] = own[i + 1];
    }
  }
  const out: string[] = [];
  const taken: number[] = [];
  let gap = false;
  ref.forEach((line, i) => {
    if (!keep[i]) {
      if (ref[i].trim() === "" && out.length) gap = true;
      return;
    }
    if (gap && out[out.length - 1] !== "") out.push("");
    gap = false;
    if (line.trim() === "" && out[out.length - 1] === "") return;
    out.push(ownLine.get(i) ?? line);
    if (own[i]) taken.push(out.length);
  });
  while (out[out.length - 1] === "") out.pop();
  return { code: out.join("\n"), lines: taken };
};

/** Whether `insertBlock` would land the block in place, or append it */
export const landsInPlace = (
  file: string,
  block: string,
  reference: string | undefined,
  start = ""
): boolean => placement(file, block, reference, start) !== null;

export interface Landing {
  lines: number[];
  /** The landing is past the end or on an empty line: draw a ghost line */
  ghost: boolean;
}

/**
 * Where an open question's answer will land in `file`: a dry run of the
 * write. A ghost line when it lands past the end or on an empty line, a tint
 * on the lines it replaces otherwise.
 */
export const landingFor = (
  code: string,
  block: string,
  reference: string | undefined,
  start = ""
): Landing | null => {
  const dry = insertBlock(code, block, reference, start);
  const dryRows = dry.code.split("\n");
  const first =
    dry.lines.find((n) => (dryRows[n - 1] ?? "").trim() !== "") ?? dry.lines[0];
  if (!first) return null;
  const rows = code.split("\n");
  const blank = code.trim() === "";
  const empty =
    blank || first > rows.length || (rows[first - 1] ?? "").trim() === "";
  if (empty) return { lines: [blank ? 1 : first], ghost: true };
  return {
    lines: dry.lines.filter(
      (n) => n <= rows.length && (rows[n - 1] ?? "").trim() !== ""
    ),
    ghost: false,
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/tutorial-conversation/model/landing", () => {
    const HEAD =
      'use anchor_lang::prelude::*;\n\ndeclare_id!("11111111111111111111111111111111");';
    const MOD =
      '#[program]\nmod hello_anchor {\n    use super::*;\n\n    pub fn hello(_ctx: Context<Hello>) -> Result<()> {\n        msg!("Hello, World!");\n        Ok(())\n    }\n}';
    const STRUCT = "#[derive(Accounts)]\npub struct Hello {}";
    const TARGET = `${HEAD}\n\n${MOD}\n\n${STRUCT}\n`;

    describe("insertBlock", () => {
      it("puts the first block at the top of an empty file", () => {
        expect(insertBlock("", HEAD, TARGET, "")).toEqual({
          code: HEAD,
          lines: [1, 2, 3],
        });
      });

      it("lands the module under the head, where the target has it", () => {
        const placed = insertBlock(HEAD, MOD, TARGET, "");
        expect(placed.code).toBe(`${HEAD}\n\n${MOD}`);
        expect(placed.lines).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13]);
      });

      it("lands the struct at the end, after the module", () => {
        const placed = insertBlock(`${HEAD}\n\n${MOD}`, STRUCT, TARGET, "");
        expect(placed.code).toBe(TARGET.trimEnd());
        expect(placed.lines).toEqual([15, 16]);
      });

      it("appends when the file holds a line the step does not know", () => {
        const file = `${HEAD}\n\nfn mine() {}`;
        const placed = insertBlock(file, MOD, TARGET, "");
        expect(placed.code).toBe(`${file}\n\n${MOD}`);
        expect(placed.lines[0]).toBe(7);
        expect(landsInPlace(file, MOD, TARGET)).toBe(false);
        expect(landsInPlace(HEAD, MOD, TARGET)).toBe(true);
      });

      it("drops a start line the block replaces", () => {
        const start = `${HEAD}\n\n#[program]\nmod hello_anchor {\n    use super::*;\n\n    pub fn hello(_ctx: Context<Hello>) -> Result<()> {\n        msg!("Hello, World!");\n        Ok(())\n    }\n}\n\n${STRUCT}\n`;
        const named = start.replace(
          'pub fn hello(_ctx: Context<Hello>) -> Result<()> {\n        msg!("Hello, World!");',
          'pub fn hello(_ctx: Context<Hello>, name: String) -> Result<()> {\n        msg!("Hello, {}!", name);'
        );
        const block =
          '    pub fn hello(_ctx: Context<Hello>, name: String) -> Result<()> {\n        msg!("Hello, {}!", name);';
        const placed = insertBlock(start, block, named, start);
        expect(placed.code).toBe(named.trimEnd());
        expect(placed.lines).toEqual([9, 10]);
      });
    });

    describe("insertBlock keeps the block's own words", () => {
      it("writes the block's msg! text, not the target's", () => {
        const own = MOD.replace("Hello, World!", "Hi there");
        const placed = insertBlock(HEAD, own, TARGET, "");
        expect(placed.code).toBe(`${HEAD}\n\n${own}`);
        expect(placed.lines).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13]);
      });
    });

    describe("holds and typedKey", () => {
      it("reads code the way a build does", () => {
        expect(holds(`${HEAD}\n// note\n${MOD}`, MOD)).toBe(true);
        expect(holds(HEAD, MOD)).toBe(false);
        expect(holds('msg!("Hi there");', 'msg!("Hello, World!");')).toBe(true);
      });

      it("finds the key line, loosely", () => {
        const file =
          "// Call it\nconst txHash = await pg.program.methods.hello().rpc()\n";
        expect(typedKey(file, "await pg.program.methods.hello().rpc();")).toBe(
          2
        );
        expect(typedKey(file, "await pg.program.methods.hello()")).toBe(2);
        expect(typedKey(file, "await pg.program.hello().rpc()")).toBeNull();
      });

      it("keeps the learner's own msg! text when filling", () => {
        expect(
          withOwnText('msg!("Hello, World!");', '    msg!("Hi, {}!", name);')
        ).toBe('msg!("Hello, World!");');
        expect(
          withOwnText('msg!("Hello, {}!", name);', 'msg!("Yo, {}!", name);')
        ).toBe('msg!("Yo, {}!", name);');
      });
    });

    describe("landingFor", () => {
      it("is a ghost line at the top of an empty file", () => {
        expect(landingFor("", HEAD, TARGET)).toEqual({
          lines: [1],
          ghost: true,
        });
      });

      it("is a ghost line under the head for the module", () => {
        expect(landingFor(HEAD, MOD, TARGET)).toEqual({
          lines: [5],
          ghost: true,
        });
      });
    });
  });
}
