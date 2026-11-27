import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  addedLines,
  extractScenarios,
  extractTestTitles,
  gate,
  parseExcluded,
  readBaseExcluded,
  readBaseManualKeys,
  readScenarios,
  readTestTitles,
} from "./spec-coverage.mjs";

const SPEC = `## ADDED Requirements

### Requirement: A theme survives a reload

#### Scenario: A saved Dracula theme
- WHEN the page reloads

#### Scenario: Switching with the keyboard (manual)

## REMOVED Requirements

#### Scenario: Gone with the old picker
`;

const root = fs.mkdtemp(path.join(os.tmpdir(), "spec-coverage-"));
after(async () => fs.rm(await root, { recursive: true, force: true }));

const writeUnder = (dir) => async (rel, text) => {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, text);
};

describe("spec:coverage", () => {
  it("reads scenarios with their (manual) mark and skips REMOVED ones", () => {
    const got = extractScenarios(SPEC, "fixture-capability");
    assert.deepEqual(
      got.map((s) => [s.name, s.manual, s.line]),
      [
        ["A saved Dracula theme", false, 5],
        ["Switching with the keyboard", true, 8],
      ]
    );
  });

  it("counts it, describe, and test.describe titles, not their skip, fixme, or todo forms", () => {
    const src = `
      describe("fixture-capability: Kept", () => {});
      test.describe("fixture-capability: Grouped", () => {});
      it("fixture-capability: Flat", () => {});
      test.only("fixture-capability: Only", () => {});
      describe.skip("fixture-capability: Parked", () => {});
      it.todo("fixture-capability: Later");
      test.fixme("fixture-capability: Broken", () => {});
      test.describe.skip("fixture-capability: Off", () => {});
    `;
    assert.deepEqual(extractTestTitles(src).sort(), [
      "fixture-capability: Flat",
      "fixture-capability: Grouped",
      "fixture-capability: Kept",
      "fixture-capability: Only",
    ]);
  });

  it("reads titles from e2e, vitest files, node tests, and skill tests, and not from other modules", async () => {
    const dir = path.join(await root, "titles");
    const write = writeUnder(dir);
    const titled = (letter) =>
      `describe("fixture-capability: ${letter}", () => {});\n`;
    await write("client-v2/e2e/a.e2e.spec.ts", titled("a"));
    await write("client-v2/src/b.test.ts", titled("b"));
    await write(
      "client-v2/src/c.ts",
      `if (import.meta.vitest) { ${titled("c")} }`
    );
    await write("client-v2/src/d.ts", titled("d"));
    await write("client-v2/scripts/e.test.mjs", titled("e"));
    await write(".claude/skills/x/scripts/f.test.mjs", titled("f"));
    await write("client-v2/node_modules/g/g.test.mjs", titled("g"));
    assert.deepEqual(
      (await readTestTitles(path.join(dir, "client-v2"))).sort(),
      [
        "fixture-capability: a",
        "fixture-capability: b",
        "fixture-capability: e",
        "fixture-capability: f",
      ]
    );
  });

  it("walks specs/ and active changes once per scenario, skipping changes/archive", async () => {
    const dir = path.join(await root, "openspec");
    const write = writeUnder(dir);
    await write("specs/fixture-capability/spec.md", "#### Scenario: Live\n");
    await write(
      "changes/ui-migration/specs/fixture-capability/spec.md",
      "## MODIFIED Requirements\n#### Scenario: Live\n#### Scenario: Proposed\n"
    );
    await write(
      "changes/archive/2026-01-01-old/specs/fixture-capability/spec.md",
      "#### Scenario: Archived\n"
    );
    const got = await readScenarios(dir);
    assert.deepEqual(
      got.map((s) => [`${s.capability}: ${s.name}`, s.gated]).sort(),
      [
        ["fixture-capability: Live", true],
        ["fixture-capability: Proposed", false],
      ]
    );
    assert.equal(
      got.find((s) => s.name === "Live").file,
      "specs/fixture-capability/spec.md"
    );
  });
});

const scenario = (name, manual, gated) => ({
  capability: "fixture-capability",
  name,
  manual,
  gated,
  file: "",
  line: 1,
});
const SCENARIOS = [
  scenario("Open", false, true),
  scenario("Tested", false, true),
  scenario("By hand", true, true),
  scenario("Proposed", false, false),
];
const TITLES = ["fixture-capability: Tested"];
const keys = (group) =>
  group.map((s) => (typeof s === "string" ? s : `${s.capability}: ${s.name}`));

describe("spec:coverage exclude list", () => {
  const cases = [
    [
      "an unmatched unlisted scenario is missing",
      [],
      "missing",
      ["fixture-capability: Open"],
    ],
    [
      "a listed matched scenario is covered",
      ["fixture-capability: Open", "fixture-capability: Tested"],
      "covered",
      ["fixture-capability: Tested"],
    ],
    [
      "a listed name with no scenario and a listed manual scenario are unknown",
      [
        "fixture-capability: Open",
        "fixture-capability: Gone",
        "fixture-capability: By hand",
      ],
      "unknown",
      ["fixture-capability: Gone", "fixture-capability: By hand"],
    ],
    [
      "a line twice is a duplicate",
      ["fixture-capability: Open", "fixture-capability: Open"],
      "duplicate",
      ["fixture-capability: Open"],
    ],
    [
      "a scenario only an active change adds is reported",
      [],
      "reported",
      ["fixture-capability: Proposed"],
    ],
  ];
  for (const [title, excluded, group, expected] of cases) {
    it(title, () => {
      assert.deepEqual(
        keys(gate(SCENARIOS, TITLES, excluded)[group]),
        expected
      );
    });
  }

  it("parses lines without comments, blanks, or trailing spaces", () => {
    assert.deepEqual(parseExcluded("# c\n\nfixture-capability: A  \n"), [
      "fixture-capability: A",
    ]);
  });
});

const gitRepo = async (name) => {
  const dir = path.join(await root, name);
  await fs.mkdir(dir, { recursive: true });
  const git = (...args) =>
    promisify(execFile)(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: dir }
    );
  await git("init", "--quiet");
  return { dir, git };
};

describe("spec:coverage base comparison", () => {
  const manualOnBase = new Set(["fixture-capability: Was manual"]);
  const cases = [
    ["a base branch without the list adds nothing", undefined, ["x"], []],
    [
      "a line the base lacks is added when its scenario was not manual there",
      ["x"],
      ["x", "y"],
      ["y"],
    ],
    [
      "a line for a scenario manual on the base is not added",
      ["x"],
      ["x", "fixture-capability: Was manual"],
      [],
    ],
    ["a removed line adds nothing", ["x", "y"], ["x"], []],
  ];
  for (const [title, base, head, expected] of cases) {
    it(title, () => {
      assert.deepEqual(addedLines(manualOnBase)(base, head), expected);
    });
  }

  it("reads the base branch's manual keys, and none on a ref without specs", async () => {
    const { dir, git } = await gitRepo("manual-repo");
    await git("commit", "--quiet", "--allow-empty", "-m", "without");
    await git("tag", "without");
    await writeUnder(dir)(
      "openspec/specs/fixture-capability/spec.md",
      "#### Scenario: Tested\n#### Scenario: By hand (manual)\n"
    );
    await git("add", ".");
    await git("commit", "--quiet", "-m", "with");
    assert.deepEqual(
      [...(await readBaseManualKeys(dir, "HEAD"))],
      ["fixture-capability: By hand"]
    );
    assert.equal((await readBaseManualKeys(dir, "without")).size, 0);
  });

  it("reads the base branch's list, and undefined on a ref without it", async () => {
    const { dir, git } = await gitRepo("repo");
    await git("commit", "--quiet", "--allow-empty", "-m", "without");
    await git("tag", "without");
    await writeUnder(dir)(
      ".claude/skills/quality-spec-coverage/excluded.txt",
      "# c\nfixture-capability: A\n"
    );
    await git("add", ".");
    await git("commit", "--quiet", "-m", "with");
    assert.deepEqual(await readBaseExcluded(dir, "HEAD"), [
      "fixture-capability: A",
    ]);
    assert.equal(await readBaseExcluded(dir, "without"), undefined);
    await assert.rejects(readBaseExcluded(dir, "no-such-ref"));
  });
});
