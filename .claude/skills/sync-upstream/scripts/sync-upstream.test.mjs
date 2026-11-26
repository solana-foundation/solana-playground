import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

import {
  dataJsonLast,
  GUARDS,
  isForkOwned,
  isGuardHit,
  isImported,
  message,
  parseImportList,
  parseSyncedTo,
  repoEnv,
  topLevel,
  wholeImportReport,
} from "./sync-upstream.mjs";

const repo = topLevel(import.meta.dirname);

const MERGED = "a7a8a1f9ed2e9a2cebafd4b59427fe61ab99702a";

const hasCommit = (rev) =>
  spawnSync("git", ["-C", repo, "cat-file", "-e", `${rev}^{commit}`], {
    env: repoEnv(),
  }).status === 0;

// `message` exits the process on a commit it cannot read, so these cases skip where the commits are absent
const withoutHistory = ["86460da5", "6ec9b806", MERGED].every(hasCommit)
  ? false
  : "needs upstream's commits, which a shallow checkout or a clone without solpg lacks";

describe("sync-upstream", () => {
  // A git hook (pre-push runs this suite) exports GIT_DIR, which outranks `git -C`
  it("finds the repository from inside a git hook", () => {
    const gitDir = execFileSync(
      "git",
      ["-C", repo, "rev-parse", "--absolute-git-dir"],
      { encoding: "utf8", env: repoEnv() }
    ).trim();
    const script = pathToFileURL(
      path.join(import.meta.dirname, "sync-upstream.mjs")
    ).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { topLevel } = await import(${JSON.stringify(script)});
         console.log(topLevel(${JSON.stringify(import.meta.dirname)}));`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_DIR: gitDir, GIT_INDEX_FILE: "index" },
      }
    );
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), repo);
  });

  it("writes the merge subject", { skip: withoutHistory }, () => {
    assert.equal(
      message(repo, "86460da5", "6ec9b806").split("\n")[0],
      "chore(upstream): merge solpg/master to 6ec9b806 (86460da5..6ec9b806)"
    );
  });

  it(
    "writes the body of the merged commit a7a8a1f9",
    { skip: withoutHistory },
    () => {
      const merged = execFileSync(
        "git",
        ["-C", repo, "log", "-1", "--format=%B", MERGED],
        { encoding: "utf8", env: repoEnv() }
      );
      const body = (text) =>
        text.split("\n").slice(1).join("\n").replace(/\n+$/, "");
      assert.equal(
        body(message(repo, "86460da5", "6ec9b806")),
        body(merged)
      );
    }
  );

  it("names a command that could not start", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(import.meta.dirname, "sync-upstream.mjs"), "prepare"],
      { encoding: "utf8", env: { PATH: path.join(repo, "no-such-dir") } }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /git: .*ENOENT/);
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

  for (const [name, local, report] of [
    ["a file the fork lacks", undefined, "whole"],
    ["a copy equal to upstream's", Buffer.from("upstream"), "current"],
    ["a copy the fork changed", Buffer.from("fork"), "differs"],
  ])
    it(`whole import: ${name} is reported as ${report}`, () => {
      assert.equal(wholeImportReport(local, Buffer.from("upstream")), report);
    });

  it("whole import: writes the tutorial's data.json after its other files", () => {
    assert.deepEqual(
      dataJsonLast("bank-simulator", [
        "tutorials/bank-simulator/about.md",
        "tutorials/bank-simulator/data.json",
        "tutorials/bank-simulator/files/data.json",
        "tutorials/bank-simulator/pages/1.md",
      ]),
      [
        "tutorials/bank-simulator/about.md",
        "tutorials/bank-simulator/files/data.json",
        "tutorials/bank-simulator/pages/1.md",
        "tutorials/bank-simulator/data.json",
      ]
    );
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
      { encoding: "utf8", env: repoEnv() }
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
