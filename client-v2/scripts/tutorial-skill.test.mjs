import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

import { FILES, FOLDER, pack } from "./tutorial-skill.mjs";

const script = fileURLToPath(new URL("./tutorial-skill.mjs", import.meta.url));

/** The zip's files, by name, as bytes */
const entries = async (bytes) => {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files).filter((f) => !f.dir);
  return Object.fromEntries(
    await Promise.all(
      files.map(async (f) => [f.name, await f.async("nodebuffer")])
    )
  );
};

test("the zip holds the three files in one folder, byte for byte", async () => {
  const got = await entries(await pack());
  assert.deepEqual(
    Object.keys(got).sort(),
    FILES.map(([name]) => `${FOLDER}/${name}`).sort()
  );
  for (const [name, source] of FILES) {
    assert.ok(got[`${FOLDER}/${name}`].equals(fs.readFileSync(source)), name);
  }
});

test("the same files make the same zip", async () => {
  assert.ok((await pack()).equals(await pack()));
});

test("the skill names its two files and no copy of them is kept beside it", () => {
  const [[, skill]] = FILES;
  const text = fs.readFileSync(skill, "utf8");
  assert.match(text, /^---\nname: tutorial-author\ndescription: \S/);
  assert.match(text, /`AUTHORING\.md`/);
  assert.match(text, /`tutorial\.schema\.json`/);
  const copies = fs
    .readdirSync(path.dirname(skill), { recursive: true })
    .filter((file) =>
      ["AUTHORING.md", "tutorial.schema.json"].includes(path.basename(file))
    );
  assert.deepEqual(copies.sort(), ["AUTHORING.md", "tutorial.schema.json"]);
});

test("the command writes the zip where it is told", async () => {
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "skill-")),
    "s.zip"
  );
  const run = spawnSync(process.execPath, [script, out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.readFileSync(out).equals(await pack()));
});
