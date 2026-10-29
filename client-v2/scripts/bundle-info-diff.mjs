// Prints the pull request comment for build/ against a base snapshot; bundle-info-report.sh runs it
import { bundleReport } from "./lib/bundle/diff.mjs";
import { measure, readSnapshot } from "./lib/bundle/snapshot.mjs";

const [basePath, baseLabel, head] = process.argv.slice(2);
if (!basePath || !baseLabel || !head) {
  console.error(
    "Usage: bundle-info-diff.mjs <base.md> <base-label> <head-sha>"
  );
  process.exit(2);
}
console.log(
  bundleReport({
    measurement: await measure(),
    committed: await readSnapshot(),
    base: await readSnapshot(basePath),
    baseLabel,
    head,
  })
);
