import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  extractScenarios,
  extractTestTitles,
  readScenarios,
  uncovered,
} from "./spec-coverage.mjs";

const SPEC = `## ADDED Requirements

### Requirement: A theme survives a reload

#### Scenario: A saved Dracula theme
- WHEN the page reloads

#### Scenario: Switching with the keyboard (manual)

## REMOVED Requirements

#### Scenario: Gone with the old picker
`;

describe("spec:coverage", () => {
  it("reads scenarios with their (manual) mark and skips REMOVED ones", () => {
    const got = extractScenarios(SPEC, "client-v2-themes");
    assert.deepEqual(
      got.map((s) => [s.name, s.manual, s.line]),
      [
        ["A saved Dracula theme", false, 5],
        ["Switching with the keyboard", true, 8],
      ]
    );
  });

  it("counts test() and test.only() titles, not test.skip or test.fixme", () => {
    const src = `
      test("client-v2-themes: A saved Dracula theme", async ({ page }) => {});
      test.only("just this", () => {});
      test.skip("parked", () => {});
      test.fixme("later", () => {});
      test.describe("a group", () => {});
    `;
    assert.deepEqual(extractTestTitles(src), [
      "client-v2-themes: A saved Dracula theme",
      "just this",
    ]);
    const scenarios = extractScenarios(SPEC, "client-v2-themes");
    assert.deepEqual(uncovered(scenarios, extractTestTitles(src)), []);
    assert.equal(
      uncovered(scenarios, ["client-v2-layers: A saved Dracula theme"]).length,
      1
    );
  });

  const root = fs.mkdtemp(path.join(os.tmpdir(), "spec-coverage-"));
  after(async () => fs.rm(await root, { recursive: true, force: true }));

  it("walks specs/ and active changes once per scenario, skipping changes/archive", async () => {
    const dir = await root;
    const write = async (rel, text) => {
      const full = path.join(dir, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, text);
    };
    await write("specs/client-v2-themes/spec.md", "#### Scenario: Live\n");
    await write(
      "changes/ui-migration/specs/client-v2-themes/spec.md",
      "## MODIFIED Requirements\n#### Scenario: Live\n#### Scenario: Proposed\n"
    );
    await write(
      "changes/archive/2026-01-01-old/specs/client-v2-themes/spec.md",
      "#### Scenario: Archived\n"
    );
    const got = await readScenarios(dir);
    assert.deepEqual(got.map((s) => `${s.capability}: ${s.name}`).sort(), [
      "client-v2-themes: Live",
      "client-v2-themes: Proposed",
    ]);
    assert.equal(
      got.find((s) => s.name === "Live").file,
      "specs/client-v2-themes/spec.md"
    );
  });
});
