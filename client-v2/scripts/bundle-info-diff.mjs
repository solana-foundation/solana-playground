// Renders the change between two bundle snapshots as a pull request comment; ported from the Solana Explorer's scripts/build-info-diff.ts
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  DISPLAY_STEP_TOLERANCE_BYTES,
  parseCellBytes,
  parseRows,
} from "./bundle-info.mjs";

const SNAPSHOT_PATH = "client-v2/bench/BUNDLE.md";

/** The data rows of a snapshot; throws when there are none, so a format change cannot read as an empty bundle */
export const parseSnapshot = (markdown) => {
  const rows = parseRows(markdown);
  if (rows.length === 0) {
    throw new Error("No table rows found; expected bundle-info.mjs output");
  }
  return rows;
};

/** Rows added, removed, or with any cell changed, fresh rows first in their order */
export const diffSnapshots = (base, fresh) => {
  const baseByKey = new Map(base.map((row) => [row.key, row]));
  const freshKeys = new Set(fresh.map((row) => row.key));
  const changes = [];
  for (const { header, key, cells } of fresh) {
    const before = baseByKey.get(key);
    if (!before) {
      changes.push({ kind: "added", header, key, after: cells });
    } else if (before.cells.join("|") !== cells.join("|")) {
      changes.push({
        kind: "changed",
        header,
        key,
        before: before.cells,
        after: cells,
      });
    }
  }
  for (const { header, key, cells } of base) {
    if (!freshKeys.has(key)) {
      changes.push({ kind: "removed", header, key, before: cells });
    }
  }
  return changes;
};

/** Whether a change is more than rounding: a size cell moved past one display step, or any other cell changed */
export const exceedsTolerance = (change) => {
  if (change.kind !== "changed") return true;
  if (change.before.length !== change.after.length) return true;
  return change.before.some((before, i) => {
    const after = change.after[i];
    const beforeBytes = parseCellBytes(before);
    const afterBytes = parseCellBytes(after);
    if (beforeBytes === undefined || afterBytes === undefined) {
      return before !== after;
    }
    return Math.abs(afterBytes - beforeBytes) > DISPLAY_STEP_TOLERANCE_BYTES;
  });
};

const movement = (before, after) => {
  if (before === undefined) return after;
  if (after === undefined) return before;
  return before === after ? after : `${before} → ${after}`;
};

const changeRow = ({ kind, key, before = [], after = [] }) => {
  const label = kind === "changed" ? `\`${key}\`` : `\`${key}\` _(${kind})_`;
  const width = Math.max(before.length, after.length);
  const cells = Array.from({ length: width }, (_, i) =>
    movement(before[i], after[i])
  );
  return `| ${label} | ${cells.join(" | ")} |`;
};

/** Significant changes as one table per snapshot table, under that table's header */
const changeTables = (significant) => {
  const byHeader = Map.groupBy(significant, (change) => change.header);
  const lines = [];
  for (const [header, changes] of byHeader) {
    const columns = header.split("|").length - 2;
    lines.push(
      "",
      header,
      `|${" --- |".repeat(columns)}`,
      ...changes.map(changeRow)
    );
  }
  return lines;
};

const count = (changes, kind) =>
  changes.filter((change) => change.kind === kind).length;

/**
 * The markdown comment for a pull request: rows that moved past one display step, the number that moved within it,
 * and the fresh tables collapsed. `base` is `null` when the base branch has no snapshot.
 */
export const formatReport = ({ base, fresh, baseLabel, stale }) => {
  const freshRows = parseSnapshot(fresh);
  const lines = [`### Bundle change vs \`${baseLabel}\``, ""];
  if (stale) {
    lines.push(
      `**\`${SNAPSHOT_PATH}\` is out of date for this branch:** run \`yarn build-fast\`, then \`yarn bundle:info\`, and commit the refreshed file.`,
      ""
    );
  }

  if (base === null) {
    lines.push(
      `\`${baseLabel}\` has no \`${SNAPSHOT_PATH}\`, so there is nothing to compare against.`
    );
  } else {
    const changes = diffSnapshots(parseSnapshot(base), freshRows);
    const significant = changes.filter(exceedsTolerance);
    if (significant.length === 0) {
      lines.push("No chunk size changed.");
    } else {
      lines.push(
        `**${count(significant, "changed")} changed, ${count(
          significant,
          "added"
        )} added, ${count(significant, "removed")} removed**`,
        ...changeTables(significant)
      );
    }
    const noise = changes.length - significant.length;
    if (noise > 0) {
      lines.push(
        "",
        `_${noise} row${
          noise === 1 ? "" : "s"
        } moved by one rounding step (noise)._`
      );
    }
  }

  const tables = fresh.slice(fresh.indexOf("\n|") + 1).trim();
  lines.push(
    "",
    "<details>",
    "<summary>Full table (fresh build)</summary>",
    "",
    tables,
    "",
    "</details>"
  );
  return lines.join("\n");
};

const readOrNull = (file) =>
  fs.readFile(file, "utf8").catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, basePath, freshPath, baseLabel = "master", committedPath] =
    process.argv.slice(2);
  if (mode !== "report" || !basePath || !freshPath) {
    console.error(
      "Usage: bundle-info-diff.mjs report <base.md> <fresh.md> [base-label] [committed.md]"
    );
    process.exit(2);
  }
  const fresh = await fs.readFile(freshPath, "utf8");
  const stale = committedPath
    ? (await readOrNull(committedPath)) !== fresh
    : false;
  console.log(
    formatReport({ base: await readOrNull(basePath), fresh, baseLabel, stale })
  );
}
