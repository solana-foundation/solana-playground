// Hysteresis reproduces every committed cell while the fresh cell stays within DISPLAY_STEP_TOLERANCE_BYTES of it, so any difference is a real size change or a hand edit
import assert from "node:assert/strict";
import test from "node:test";

import { diffSnapshots } from "./lib/bundle/diff.mjs";
import {
  isStale,
  measure,
  parseRows,
  readSnapshot,
  REFRESH_STEPS,
  renderSnapshot,
} from "./lib/bundle/snapshot.mjs";
import { wasmStubsRequested } from "./wasm-stubs.mjs";

const changeLine = ({ kind, key, before = [], after = [] }) =>
  `  ${key}: ${kind} ${before.join(" / ") || "-"} -> ${
    after.join(" / ") || "-"
  }`;

// The snapshot measures the real wasm packages, so a stub build cannot reproduce it.
const skip =
  wasmStubsRequested(process.env) && "USE_WASM_STUBS=true: a stub build";

test("bench/BUNDLE.md matches the build byte for byte", { skip }, async () => {
  const measurement = await measure();
  const committed = await readSnapshot();
  if (!isStale(measurement, committed)) return;

  const rows = diffSnapshots(
    parseRows(committed ?? ""),
    parseRows(renderSnapshot(measurement, committed))
  ).map(changeLine);
  const detail = rows.length
    ? rows.join("\n")
    : "  (only the text outside the tables differs)";
  assert.fail(
    `bench/BUNDLE.md is out of date with this build: ${REFRESH_STEPS}\n${detail}`
  );
});
