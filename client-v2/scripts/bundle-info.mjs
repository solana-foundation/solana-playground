// `yarn bundle:info`: writes the snapshot of build/ to bench/BUNDLE.md
import fs from "node:fs/promises";
import path from "node:path";

import { freshSnapshot, SNAPSHOT } from "./lib/bundle/snapshot.mjs";

await fs.writeFile(SNAPSHOT, await freshSnapshot());
console.log(`Wrote ${path.relative(process.cwd(), SNAPSHOT)}`);
