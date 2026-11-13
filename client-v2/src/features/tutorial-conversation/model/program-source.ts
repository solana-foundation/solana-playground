/** Where every Anchor tutorial keeps its program */
export const PROGRAM_FILE = "src/lib.rs";

/** The body of the `#[program]` module, braces matched; empty without one */
export const programModule = (source: string): string => {
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

/**
 * The instructions a program's source defines: the `pub fn`s of its
 * `#[program]` module. What a build goal checks when the build returned no
 * IDL (Anchor 1.1.2, HOO-2688): the learner's own code, never the lesson's.
 */
export const programInstructions = (source: string): string[] =>
  Array.from(
    // eslint-disable-next-line security/detect-unsafe-regex -- linear: `\s*`, `<[^>]*>` and `\(` start with disjoint characters
    programModule(source).matchAll(/pub fn (\w+)\s*(?:<[^>]*>\s*)?\(/g),
    (m) => m[1]
  );

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/tutorial-conversation/model/program-source", () => {
    it("lists the program module's pub fns, and nothing outside it", () => {
      expect(
        programInstructions(`
use anchor_lang::prelude::*;
#[program]
mod p {
    use super::*;
    pub fn hello(_ctx: Context<Hello>) -> Result<()> { if true { msg!("x"); } Ok(()) }
    fn private(_x: u8) {}
    pub fn grow<'info>(_ctx: Context<'_, '_, '_, 'info, G<'info>>, len: u32) -> Result<()> { Ok(()) }
}
impl X { pub fn helper(&self) {} }
`)
      ).toEqual(["hello", "grow"]);
    });

    it("lists none for a source without a program module", () => {
      expect(programInstructions("pub fn hello() {}")).toEqual([]);
      expect(programInstructions("")).toEqual([]);
    });
  });
}
