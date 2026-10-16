import { createFramework } from "../create";

export const anchor = createFramework({
  name: "Anchor",
  description:
    "Anchor is a framework providing several convenient developer tools for writing Solana programs.",
  language: "Rust",
  docs: {
    url: "https://www.anchor-lang.com/docs/quickstart/solpg",
  },
  githubExample: {
    name: "Create Account",
    url: "https://github.com/solana-developers/program-examples/tree/main/basics/create-account/anchor",
  },
  getIsCurrent: (files) => {
    // Return false for Seahorse workspaces, otherwise this would return a
    // false positive because every Seahorse workspace is a valid Anchor
    // workspace. The check matches Seahorse's own: a Python file is only a
    // sign of Seahorse when it imports the prelude. Any `.py` at all is too
    // broad -- Anchor repositories keep fuzzing and tooling scripts next to
    // the program.
    //
    // TODO: Handle this check from Seahorse side. Ideally we wouldn't need to
    // include Seahorse related checks in any of the Anchor files.
    const isSeahorse = files.some(
      ([path, content]) =>
        path.endsWith(".py") && content.includes("seahorse.prelude")
    );
    if (isSeahorse) return false;

    for (const [path, content] of files) {
      if (!path.endsWith("lib.rs")) continue;
      const hasProgramMacro = content.includes("#[program]");
      if (hasProgramMacro) return true;
    }

    return false;
  },
});
