import { createFramework } from "../create";

export const seahorse = createFramework({
  name: "Seahorse",
  description: "Write Anchor-compatible Solana programs in Python.",
  language: "Python",
  circleImage: true,
  docs: {
    url: "https://www.seahorse.dev/using-seahorse/accounts",
  },
  // No example: program-examples dropped its Seahorse ports, and an Anchor
  // one under the Seahorse name misled
  getIsCurrent: (files) => {
    for (const [path, content] of files) {
      if (!path.endsWith(".py")) continue;
      const isSeahorse = content.includes("seahorse.prelude");
      if (isSeahorse) return true;
    }

    return false;
  },
});
