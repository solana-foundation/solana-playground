// Renders the change between two bundle snapshots as a pull request comment; ported from the Solana Explorer's scripts/build-info-diff.ts
import {
  DISPLAY_STEP_TOLERANCE_BYTES,
  isStale,
  parseCellBytes,
  parseRows,
  renderTables,
  SNAPSHOT_PATH,
  TOLERANCE_LABEL,
} from "./snapshot.mjs";

/** The data rows of a snapshot; throws when there are none, so a format change cannot read as an empty bundle */
export const parseSnapshot = (markdown) => {
  const rows = parseRows(markdown);
  if (rows.length === 0) {
    throw new Error(
      "No table rows found; expected the tables renderTables in snapshot.mjs writes"
    );
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

/** Whether a change is more than rounding: a size cell more than {@link DISPLAY_STEP_TOLERANCE_BYTES} from its base cell, or any other cell changed */
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
 * The markdown comment for a pull request at commit `head`: rows of the `fresh` tables past the tolerance, the number
 * of rows within it, and the fresh tables collapsed. `base` is `null` when the base branch has no snapshot.
 */
export const formatReport = ({ base, fresh, baseLabel, head, stale }) => {
  const freshRows = parseSnapshot(fresh);
  // A sticky comment outlives a run that fails before its report, so it names the commit it measured
  const lines = [
    `### Bundle change vs \`${baseLabel}\``,
    "",
    `Head: ${head}`,
    "",
  ];
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
      lines.push(`No row moved past the ${TOLERANCE_LABEL} tolerance.`);
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
        } moved within the ${TOLERANCE_LABEL} tolerance (noise)._`
      );
    }
  }

  lines.push(
    "",
    "<details>",
    "<summary>Full table (fresh build)</summary>",
    "",
    fresh.trim(),
    "",
    "</details>"
  );
  return lines.join("\n");
};

/**
 * {@link formatReport} for a measurement of `build/`; `committed` and `base` are snapshots, `null` when absent.
 * The diff renders the measurement unanchored, so the tolerance applies once, against `base`: anchored on `committed`,
 * a cell could sit one tolerance from `committed` and two from `base`. Only the stale check reads `committed`.
 */
export const bundleReport = ({
  measurement,
  committed,
  base,
  baseLabel,
  head,
}) =>
  formatReport({
    base,
    fresh: renderTables(measurement),
    baseLabel,
    head,
    stale: isStale(measurement, committed),
  });
