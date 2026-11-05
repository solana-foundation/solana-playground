import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { overlayStatic } from "./static-overlay.mjs";

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), "static-overlay-"));

const write = async (file, content) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
};

test("a fork-owned file replaces the mirrored upstream one", async () => {
  const from = await tempDir();
  const to = await tempDir();
  await write(path.join(from, "programs", "programs.json"), "[1]");
  await write(path.join(to, "programs", "programs.json"), "[1,2,3]");

  const copied = await overlayStatic(from, to);

  assert.equal(
    await fs.readFile(path.join(to, "programs", "programs.json"), "utf8"),
    "[1]"
  );
  assert.deepEqual(copied, [path.join("programs", "programs.json")]);
});

test("Markdown stays out of the served files", async () => {
  const from = await tempDir();
  const to = await tempDir();
  await write(path.join(from, "programs", "README.md"), "criteria");
  await write(path.join(from, "programs", "programs.json"), "[]");

  await overlayStatic(from, to);

  await assert.rejects(fs.access(path.join(to, "programs", "README.md")));
});

test("mirrored files the fork does not own are left alone", async () => {
  const from = await tempDir();
  const to = await tempDir();
  await write(path.join(from, "programs", "programs.json"), "[]");
  await write(path.join(to, "index.html"), "upstream");

  await overlayStatic(from, to);

  assert.equal(
    await fs.readFile(path.join(to, "index.html"), "utf8"),
    "upstream"
  );
});

test("a nested file lands in a folder the mirror lacks", async () => {
  const from = await tempDir();
  const to = await tempDir();
  await write(path.join(from, "a", "b", "c.json"), "{}");

  await overlayStatic(from, to);

  assert.equal(
    await fs.readFile(path.join(to, "a", "b", "c.json"), "utf8"),
    "{}"
  );
});

test("dotfiles stay out of the served files", async () => {
  const from = await tempDir();
  const to = await tempDir();
  await write(path.join(from, "programs", ".DS_Store"), "x");
  await write(path.join(from, "programs", "programs.json"), "[]");

  const copied = await overlayStatic(from, to);

  assert.deepEqual(copied, [path.join("programs", "programs.json")]);
});
