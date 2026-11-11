import type { TupleFiles } from "../../utils";

/** The program `Cargo.toml`'s `idl-build` feature line, which `anchor idl build` compiles with. */
export const getIdlBuildFeature = (files: TupleFiles) => {
  const isUsingAnchorSpl = files.some(
    ([path, content]) =>
      path.endsWith(".rs") && content.includes("anchor_spl::")
  );
  const features = isUsingAnchorSpl
    ? `"anchor-lang/idl-build", "anchor-spl/idl-build"`
    : `"anchor-lang/idl-build"`;
  return `idl-build = [${features}]`;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("frameworks/anchor/idl-build-feature", () => {
    it.each([
      {
        uses: "anchor-lang only",
        files: [["programs/p/src/lib.rs", "use anchor_lang::prelude::*;"]],
        feature: 'idl-build = ["anchor-lang/idl-build"]',
      },
      {
        uses: "anchor-spl",
        files: [
          ["programs/p/src/lib.rs", "use anchor_lang::prelude::*;"],
          ["programs/p/src/state.rs", "use anchor_spl::token::Token;"],
        ],
        feature:
          'idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]',
      },
      {
        uses: "anchor-spl only in a client file",
        files: [
          ["programs/p/src/lib.rs", "use anchor_lang::prelude::*;"],
          ["client/client.ts", "// anchor_spl::token"],
        ],
        feature: 'idl-build = ["anchor-lang/idl-build"]',
      },
    ] as { uses: string; files: TupleFiles; feature: string }[])(
      "writes the feature for a program using $uses",
      ({ files, feature }) => {
        expect(getIdlBuildFeature(files)).toBe(feature);
      }
    );
  });
}
