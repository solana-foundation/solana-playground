import { createFramework } from "../create";

export const seahorse = createFramework({
  name: "Seahorse",
  description: "Write Anchor-compatible Solana programs in Python.",
  language: "Python",
  circleImage: true,
  docs: {
    url: "https://www.seahorse.dev/using-seahorse/accounts",
  },
  // program-examples dropped its Seahorse ports; the Anchor one stands in
  // until the customer picks the examples to list
  githubExample: {
    name: "Transfer SOL (Anchor)",
    url: "https://github.com/solana-foundation/program-examples/tree/main/basics/transfer-sol/anchor",
  },
  getIsCurrent: (files) => {
    for (const [path, content] of files) {
      if (!path.endsWith(".py")) continue;
      const isSeahorse = content.includes("seahorse.prelude");
      if (isSeahorse) return true;
    }

    return false;
  },
});
