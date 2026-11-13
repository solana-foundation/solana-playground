import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { readIdl } from "@/entities/idl";
import type { TutorialDefinition } from "@/entities/tutorial";
import { PUB_FN } from "@/features/tutorial-conversation/model/program-source";

/**
 * A step's `idl` is generated from its target program (`yarn tutorial:idl`),
 * and nothing else regenerates it: a program edited without it would ship an
 * IDL the Call panel calls with and the program refuses. These tests read the
 * program's `#[program]` module and hold every step's IDL to its instruction
 * names, argument names and the types of plain arguments, without Rust.
 */

const PROGRAM_FILE = "src/lib.rs";

interface Shape {
  /** Instruction name to its arguments, in order, as `name: type` */
  [instruction: string]: string[];
}

/** The IDL's name for a plain Rust type; anything else compares by name only */
const PLAIN = new Set(
  ["bool", "u8", "u16", "u32", "u64", "u128", "i8", "i16", "i32", "i64"].concat(
    ["i128", "f32", "f64", "string", "pubkey"]
  )
);
const plain = (type: string) =>
  PLAIN.has(type.toLowerCase()) ? type.toLowerCase() : "*";

/** The body of the `#[program]` module, braces matched */
const programModule = (source: string): string => {
  const at = source.indexOf("#[program]");
  const open = at === -1 ? -1 : source.indexOf("{", at);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
};

/** Splits on the commas outside `<>` and `()` */
const params = (list: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    if ("<(".includes(list[i])) depth++;
    if (">)".includes(list[i])) depth--;
    if (list[i] === "," && depth === 0) {
      out.push(list.slice(from, i));
      from = i + 1;
    }
  }
  return out
    .concat(list.slice(from))
    .map((p) => p.trim())
    .filter(Boolean);
};

/** The `pub fn`s of the `#[program]` module and their arguments after `ctx` */
const shapeOfSource = (source: string): Shape => {
  const body = programModule(source);
  const shape: Shape = {};
  for (const fn of body.matchAll(PUB_FN)) {
    // The parameter list runs to the parenthesis that closes it
    const start = (fn.index ?? 0) + fn[0].length;
    let depth = 1;
    let end = start;
    while (end < body.length && depth > 0) {
      if (body[end] === "(") depth++;
      if (body[end] === ")") depth--;
      end++;
    }
    shape[fn[1]] = params(body.slice(start, end - 1))
      .slice(1)
      .map((p) => {
        const [name, ...type] = p.split(":");
        return `${name.trim().replace(/^_/, "")}: ${plain(
          type.join(":").trim()
        )}`;
      });
  }
  return shape;
};

const shapeOfIdl = (idl: string): Shape => {
  const { instructions } = JSON.parse(idl) as {
    instructions: { name: string; args: { name: string; type: unknown }[] }[];
  };
  return Object.fromEntries(
    instructions.map((ix) => [
      ix.name,
      ix.args.map(
        (a) => `${a.name}: ${typeof a.type === "string" ? plain(a.type) : "*"}`
      ),
    ])
  );
};

const tutorials = readdirSync(__dirname, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("__"))
  .map((e) => join(__dirname, e.name, "tutorial.json"))
  .filter(existsSync)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- reads the repository's own files
  .map((path) => JSON.parse(readFileSync(path, "utf8")) as TutorialDefinition)
  .filter((d) => d.framework === "Anchor");

describe("tutorials: shipped IDLs", () => {
  it("covers the Breakpoint tutorials", () => {
    expect(tutorials.map((d) => d.name)).toEqual(
      expect.arrayContaining(["Hello Anchor", "Zero Copy"])
    );
  });

  describe.each(tutorials.map((d) => [d.name, d] as const))(
    "%s",
    (_name, d) => {
      it("ships an IDL from its first step with a program", () => {
        const first = d.steps.find((s) => s.target[PROGRAM_FILE]);
        expect(first?.idl).toBeDefined();
      });

      it.each(
        d.steps
          .filter((s) => s.idl !== undefined)
          .map((s) => [s.id, s] as const)
      )("step %s ships an IDL the client can call with", (_id, step) => {
        expect(readIdl(JSON.parse(step.idl as string))).toMatchObject({
          kind: expect.not.stringMatching(/^refused$/),
        });
      });

      it.each(d.steps.map((s, i) => [s.id, i] as const))(
        "step %s calls the program its target holds",
        (_id, i) => {
          const source =
            d.steps[i].target[PROGRAM_FILE] ?? d.steps[i].start[PROGRAM_FILE];
          if (!source) return;
          const idl = d.steps
            .slice(0, i + 1)
            .reverse()
            .find((s) => s.idl !== undefined)?.idl;
          expect(idl, "no IDL holds at this step").toBeDefined();
          expect(shapeOfIdl(idl as string)).toEqual(shapeOfSource(source));
        }
      );
    }
  );
});

describe("tutorials: shipped IDLs: reading a program", () => {
  it("reads only the program module, generic and tuple arguments whole", () => {
    expect(
      shapeOfSource(`
#[program]
pub mod p {
    use super::*;
    pub fn a(ctx: Context<A>, m: HashMap<u8, u8>, t: Option<(u8, u8)>, n: u64) -> Result<()> { Ok(()) }
}
impl X { pub fn helper(&self, k: u8) {} }
`)
    ).toEqual({ a: ["m: *", "t: *", "n: u64"] });
  });

  it("tells a changed argument type", () => {
    const idl = JSON.stringify({
      instructions: [{ name: "a", args: [{ name: "n", type: "u32" }] }],
    });
    expect(shapeOfIdl(idl)).not.toEqual(
      shapeOfSource("#[program] mod p { pub fn a(ctx: Context<A>, n: u64) {} }")
    );
  });
});
