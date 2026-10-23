// Hysteresis reproduces every committed cell while the bytes move within one display step, so any difference is a real size change or a hand edit
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { diffSnapshots } from "./bundle-info-diff.mjs";
import { freshSnapshot, parseRows, SNAPSHOT } from "./bundle-info.mjs";

const changeLine = ({ kind, key, before = [], after = [] }) =>
  `  ${key}: ${kind} ${before.join(" / ") || "-"} -> ${
    after.join(" / ") || "-"
  }`;

test("bench/BUNDLE.md matches the build byte for byte", async () => {
  const fresh = await freshSnapshot();
  const committed = await fs.readFile(SNAPSHOT, "utf8").catch((e) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });
  if (committed === fresh) return;

  const rows = diffSnapshots(parseRows(committed), parseRows(fresh)).map(
    changeLine
  );
  const detail = rows.length
    ? rows.join("\n")
    : "  (only the text outside the tables differs)";
  assert.fail(
    `bench/BUNDLE.md is out of date with this build: run yarn bundle:info and commit the refreshed file\n${detail}`
  );
});
