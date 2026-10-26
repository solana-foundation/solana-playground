// `.nvmrc` owns the Node version. A `FROM` line cannot read a file, and yarn 1
// wants a range in `engines`, so both repeat the number; a bump that misses
// one runs the wrong Node in Docker or refuses `yarn install`.
//
// The Dockerfile is checked as text, not by `node --version` in the built
// image: the image copies from the wasm image (`additional_contexts` in
// `compose.yaml`), which takes about an hour to build and no CI job builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(CLIENT, file), "utf8");

const version = read(".nvmrc").trim();

test("the Dockerfile base image is the .nvmrc Node", () => {
  const value = read("Dockerfile").match(/^ARG IMAGE=(.+)$/m)?.[1];
  // The default may be quoted; the quotes are not part of the tag.
  const image = value?.replace(/["']/g, "");
  assert.equal(image, `node:${version}`);
});

test("engines.node is a caret range on the .nvmrc Node", () => {
  const { engines } = JSON.parse(read("package.json"));
  assert.equal(engines.node, `^${version}`);
});
