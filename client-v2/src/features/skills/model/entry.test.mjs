import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validateSkills } from "./entry.mjs";

const COMMIT = "72ef2aa814cca4662341bfcdc01cdc288e9bb502";

/** A community skill read from `baseUrl` */
const communitySkill = (baseUrl) => ({
  id: "surfpool",
  name: "Surfpool",
  description: "d",
  source: { type: "remote", baseUrl, entry: "SKILL.md" },
  enabled: false,
  community: { repo: "sendaifun/skills" },
});

describe("validateSkills", () => {
  test("A community skill pinned to a commit on raw.githubusercontent.com is listed", () => {
    const baseUrl = `https://raw.githubusercontent.com/sendaifun/skills/${COMMIT}/skills/surfpool/`;

    const [skill] = validateSkills([communitySkill(baseUrl)]);

    assert.equal(skill.source.baseUrl, baseUrl);
  });

  for (const [label, baseUrl] of [
    [
      "a branch",
      "https://raw.githubusercontent.com/sendaifun/skills/main/skills/surfpool/",
    ],
    [
      "another host",
      `https://skills.test/sendaifun/skills/${COMMIT}/skills/surfpool/`,
    ],
  ]) {
    test(`A community skill read from ${label}: the error names the skill`, () => {
      assert.throws(
        () => validateSkills([communitySkill(baseUrl)]),
        /^Error: Skill "surfpool": a community skill's "source.baseUrl" must be/
      );
    });
  }
});
