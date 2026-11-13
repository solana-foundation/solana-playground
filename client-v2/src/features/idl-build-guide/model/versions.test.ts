// Reads the server's files from disk, which an in-source block cannot import.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ANCHOR_VERSION, SOLANA_VERSION } from "./versions";

const SERVER = path.join(__dirname, "../../../../../server");

// eslint-disable-next-line security/detect-non-literal-fs-filename -- reads the repository's own files
const read = (rel: string) => fs.readFileSync(path.join(SERVER, rel), "utf8");

/** The version of `name` in a Cargo.lock; throws when the lock has none */
const lockedVersion = (lock: string, name: string) => {
  // eslint-disable-next-line security/detect-non-literal-regexp -- a pattern this test builds from its own constants
  const match = new RegExp(
    `\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`
  ).exec(lock);
  if (!match) throw new Error(`${name} is not in the lockfile`);
  return match[1];
};

describe("features/idl-build-guide/model/versions", () => {
  it.each(["anchor-lang", "anchor-spl"])(
    "matches the %s version the build server locks",
    (crate) => {
      expect(lockedVersion(read("programs/Cargo.lock"), crate)).toBe(
        ANCHOR_VERSION
      );
    }
  );

  it("matches the Solana version the build server image installs", () => {
    const match = /ARG SOLANA_VERSION="([^"]+)"/.exec(read("Dockerfile"));
    expect(match?.[1]).toBe(SOLANA_VERSION);
  });
});
