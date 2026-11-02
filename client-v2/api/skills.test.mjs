/* eslint-disable no-template-curly-in-string -- the placeholders are the point */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import handler from "./skills.mjs";

const makeRes = () => ({
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(k, v) {
    this.headers[k] = v;
  },
  end(b) {
    this.body = b ?? "";
  },
});

/** The route's answer to `method` from a caller with no session */
const call = async (method) => {
  const res = makeRes();
  await handler({ method, url: "/api/skills", headers: {} }, res);
  return res;
};

describe("/api/skills", () => {
  // `yarn test-api` loads `.env`, which may set the override these cases control
  beforeEach(() => {
    delete process.env.SOURCES;
    delete process.env.SKILL_BASE_URL;
  });
  afterEach(() => {
    delete process.env.SOURCES;
    delete process.env.SKILL_BASE_URL;
  });

  it("The shipped catalogue signed out: both Foundation skills, and surfpool switched off", async () => {
    const res = await call("GET");
    const { skills } = JSON.parse(res.body);
    const byId = new Map(skills.map((skill) => [skill.id, skill]));

    assert.equal(res.statusCode, 200);
    assert.deepEqual(byId.get("playground-env").source, { type: "bundled" });
    assert.equal(byId.get("solana-dev").source.type, "remote");
    assert.equal(byId.get("solana-dev").source.entry, "SKILL.md");
    assert.equal(byId.get("surfpool")?.enabled, false);
    assert.deepEqual(byId.get("surfpool").community, {
      repo: "sendaifun/skills",
    });
  });

  it("A remote skill's base URL from the environment", async () => {
    process.env.SKILL_BASE_URL = "https://skills.test/team/";
    process.env.SOURCES = JSON.stringify([
      {
        kind: "skill",
        id: "team",
        name: "Team",
        description: "Team conventions.",
        source: {
          type: "remote",
          baseUrl: "${SKILL_BASE_URL}",
          entry: "SKILL.md",
        },
      },
    ]);

    const { skills } = JSON.parse((await call("GET")).body);

    assert.deepEqual(skills, [
      {
        id: "team",
        name: "Team",
        description: "Team conventions.",
        source: {
          type: "remote",
          baseUrl: "https://skills.test/team/",
          entry: "SKILL.md",
        },
        enabled: true,
      },
    ]);
  });

  it("answers 500 naming the duplicate id when two entries share one", async () => {
    process.env.SOURCES = JSON.stringify([
      { kind: "mcp", id: "solana", name: "s", url: "https://s.test/mcp" },
      {
        kind: "skill",
        id: "solana",
        name: "s",
        description: "d",
        source: { type: "bundled" },
      },
    ]);

    const res = await call("GET");

    assert.equal(res.statusCode, 500);
    assert.match(JSON.parse(res.body).error, /"solana"/);
  });

  it("answers 405 to POST", async () => {
    const res = await call("POST");

    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET");
  });
});
