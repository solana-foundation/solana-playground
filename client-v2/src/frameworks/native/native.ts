import { createFramework } from "../create";
import icon from "./icon.svg";

export const native = createFramework({
  name: "Native",
  description: "Solana programs without a framework.",
  language: "Rust",
  icon,
  docs: {
    url: "https://solana.com/docs/intro/quick-start",
    name: "Solana",
    description: "The official Solana developer documentation.",
  },
  githubExample: {
    name: "Hello Solana",
    // Only import the program for now since `fs` and `os` modules are not
    // implemented in Playground. We could solve it by converting the code
    // where it reads the user keypair and the program keypair but the goal
    // is to make everything that works in a local Node environment work in
    // Playground without any modifications.
    // TODO: Implement `fs` and `os` modules.
    // url: "https://github.com/solana-foundation/program-examples/tree/main/basics/hello-solana/native",
    url: "https://github.com/solana-foundation/program-examples/tree/main/basics/hello-solana/native/program",
  },
  getIsCurrent: (files) => {
    for (const [path, content] of files) {
      if (!path.endsWith(".rs")) continue;
      const hasEntryPointMacro = content.includes("entrypoint!");
      if (hasEntryPointMacro) return true;
    }

    return false;
  },
});
