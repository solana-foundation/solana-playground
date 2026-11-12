import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  GUARDS,
  isForkOwned,
  isGuardHit,
  isImported,
  message,
  parseImportList,
  parseSyncedTo,
} from "./sync-upstream.mjs";

const repo = execFileSync(
  "git",
  ["-C", import.meta.dirname, "rev-parse", "--show-toplevel"],
  { encoding: "utf8" }
).trim();

describe("sync-upstream", () => {
  const generated = message(repo, "86460da5", "6ec9b806");

  it("writes the merge subject", () => {
    assert.equal(
      generated.split("\n")[0],
      "chore(upstream): merge solpg/master to 6ec9b806 (86460da5..6ec9b806)"
    );
  });

  it("writes the body of the merged commit a7a8a1f9", () => {
    const merged = execFileSync(
      "git",
      [
        "-C",
        repo,
        "log",
        "-1",
        "--format=%B",
        "a7a8a1f9ed2e9a2cebafd4b59427fe61ab99702a",
      ],
      { encoding: "utf8" }
    );
    const body = (text) =>
      text.split("\n").slice(1).join("\n").replace(/\n+$/, "");
    assert.equal(body(generated), body(merged));
  });

  for (const [subject, to] of [
    ["chore(upstream): sync to 1bfdfabc (6ec9b806..1bfdfabc)", "1bfdfabc"],
    [
      "chore(upstream): merge solpg/master to 1693239d (1bfdfabc..1693239d)",
      "1693239d",
    ],
  ])
    it(`reads ${to} from "${subject}"`, () => {
      assert.equal(parseSyncedTo(subject), to);
    });

  const compose = GUARDS.find((entry) => entry.startsWith("compose.yaml ^  "));
  const share = GUARDS.find((entry) => entry === "server/src/routes/share.rs");
  for (const [name, entry, merged, target, hit] of [
    [
      "a service line after the first line",
      compose,
      "services:\n  client:\n",
      "services:\n",
      true,
    ],
    [
      "content the target also has",
      compose,
      "services:\n  client:\n",
      "services:\n  client:\n",
      false,
    ],
    ["a path the target lacks", share, "", undefined, true],
    ["a path the target has", share, "", "", false],
  ])
    it(`guard: ${name} is ${hit ? "a hit" : "no hit"}`, () => {
      assert.equal(isGuardHit(entry, merged, target), hit);
    });

  const entries = parseImportList(
    "# a comment\nrobots.txt\nfonts/ # the fonts\ntutorials/hello-anchor/thumbnail.jpg\n"
  );
  for (const [name, file, imported] of [
    ["a listed file", "robots.txt", true],
    ["a file under a listed folder", "fonts/Hack.woff2", true],
    [
      "a file of an enabled Markdown tutorial",
      "tutorials/bank-simulator/pages/1.md",
      true,
    ],
    [
      "a file of a tutorial that is not enabled",
      "tutorials/battle-coins/pages/1.md",
      false,
    ],
    [
      "an unlisted file beside a listed file",
      "tutorials/hello-anchor/about.md",
      false,
    ],
    ["a comment line", "# a comment", false],
  ])
    it(`import list: ${name} is ${imported ? "" : "not "}imported`, () => {
      assert.equal(isImported(entries, ["bank-simulator"], file), imported);
    });

  it("imports or owns every tracked file under client-v2/public/", () => {
    const listed = parseImportList(
      readFileSync(
        path.join(repo, "client-v2/scripts/assets-import.txt"),
        "utf8"
      )
    );
    const tutorials = Object.keys(
      JSON.parse(
        readFileSync(
          path.join(repo, "client-v2/src/tutorials/markdown-tutorials.json"),
          "utf8"
        )
      )
    );
    // The working tree's files, untracked ones included and ignored ones left out.
    const tracked = execFileSync(
      "git",
      [
        "-C",
        repo,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        "client-v2/public",
      ],
      { encoding: "utf8" }
    )
      .split("\n")
      .filter((file) => file && existsSync(path.join(repo, file)))
      .map((file) => file.slice("client-v2/public/".length));
    assert.ok(tracked.length > 0);
    assert.deepEqual(
      tracked.filter(
        (file) => !isImported(listed, tutorials, file) && !isForkOwned(file)
      ),
      []
    );
  });
});
