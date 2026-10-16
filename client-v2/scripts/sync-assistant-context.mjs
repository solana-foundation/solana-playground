// Sync the assistant's context document into the client bundle.
//
// `docs/assistant-context.md` is the source of truth — it is what the team
// maintains and what the "What we're building" tab renders. CRA's
// `ModuleScopePlugin` stops `client/src` importing across the repo root, so it
// is copied in here instead. See docs/decisions.md -> D6.

import fs from "fs/promises";
import pathModule from "path";

import { CLIENT_PATH, REPO_ROOT_PATH } from "./utils.mjs";

const SOURCE_PATH = pathModule.join(
  REPO_ROOT_PATH,
  "docs",
  "assistant-context.md"
);
const OUTPUT_PATH = pathModule.join(
  CLIENT_PATH,
  "src",
  "views",
  "sidebar",
  "assistant",
  "content",
  "assistant-context.md"
);

const content = await fs.readFile(SOURCE_PATH, "utf8");

await fs.mkdir(pathModule.dirname(OUTPUT_PATH), { recursive: true });
await fs.writeFile(
  OUTPUT_PATH,
  `<!-- Generated from docs/assistant-context.md. Edit that file, not this one. -->\n\n${content}`
);

console.log(`Synced assistant context (${content.length} chars)`);
