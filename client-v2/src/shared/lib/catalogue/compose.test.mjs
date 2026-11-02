/* eslint-disable no-template-curly-in-string -- the placeholders are the point */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { composeCatalogue } from "./compose.mjs";

/** An `mcp` entry as `SOURCES` carries it */
const server = (id, url) => ({ kind: "mcp", id, name: id, url });

/** `SOURCES` holding these entries */
const sources = (...entries) => JSON.stringify(entries);

const ids = (entries) => entries.map((entry) => entry.id);

describe("composeCatalogue", () => {
  describe("A placeholder is filled from the environment", () => {
    for (const [where, entry] of [
      ["url", server("docs", "https://${DOCS_HOST}/mcp")],
      [
        "a header",
        {
          kind: "mcp",
          id: "docs",
          name: "docs",
          url: "https://docs.test/mcp",
          headers: { authorization: "Bearer ${DOCS_HOST}" },
        },
      ],
    ]) {
      test(`A required variable is unset: an entry naming it in its ${where} is absent`, () => {
        const composed = composeCatalogue({
          env: { DOCS_HOST: "" },
          override: sources(entry),
          signedIn: true,
        });

        assert.deepEqual(composed.mcp, []);
      });
    }

    test("fills a variable that is set", () => {
      const composed = composeCatalogue({
        env: { DOCS_HOST: "docs.test" },
        override: sources(server("docs", "https://${DOCS_HOST}/mcp")),
        signedIn: false,
      });

      assert.equal(composed.mcp[0].url, "https://docs.test/mcp");
    });

    test("The Explorer URL takes its default", () => {
      const explorer = (env) =>
        composeCatalogue({ env, signedIn: false }).mcp.find(
          (entry) => entry.id === "explorer"
        );

      assert.equal(explorer({}).url, "https://explorer.solana.com/mcp");
      assert.equal(
        explorer({ MCP_EXPLORER_URL: "https://explorer.test/mcp" }).url,
        "https://explorer.test/mcp"
      );
    });
  });

  describe("An optional credential resolved empty is not sent", () => {
    test("Explorer with nothing set: no authorization header and no bypass secret", () => {
      const explorer = composeCatalogue({ env: {}, signedIn: false }).mcp.find(
        (entry) => entry.id === "explorer"
      );

      assert.deepEqual(explorer.headers, {});
      assert.deepEqual(explorer.protection, { provider: "vercel" });
    });

    test("keeps an optional credential whose variable is set", () => {
      const explorer = composeCatalogue({
        env: { MCP_EXPLORER_TOKEN: "t-1" },
        signedIn: false,
      }).mcp.find((entry) => entry.id === "explorer");

      assert.deepEqual(explorer.headers, { authorization: "Bearer t-1" });
    });
  });

  describe("The override replaces the catalogue", () => {
    test("Two servers through the override", () => {
      const composed = composeCatalogue({
        env: {},
        override: sources(
          server("a", "https://a.test/mcp"),
          server("b", "https://b.test/mcp")
        ),
        signedIn: false,
      });

      assert.deepEqual(ids(composed.mcp), ["a", "b"]);
      assert.deepEqual(composed.skill, []);
    });

    for (const [label, override] of [
      ["is not JSON", "[{"],
      ["is not an array", '{"kind":"mcp"}'],
    ]) {
      test(`The override ${label}: the error names SOURCES`, () => {
        assert.throws(
          () => composeCatalogue({ env: {}, override, signedIn: false }),
          /^Error: SOURCES /
        );
      });
    }
  });

  test("A signed-in entry and a signed-out caller", () => {
    const override = sources({
      kind: "mcp",
      id: "team",
      name: "team",
      url: "https://team.test/mcp",
      signedIn: true,
    });

    assert.deepEqual(
      composeCatalogue({ env: {}, override, signedIn: false }).mcp,
      []
    );
    assert.deepEqual(
      composeCatalogue({ env: {}, override, signedIn: true }).mcp,
      [{ id: "team", name: "team", url: "https://team.test/mcp" }]
    );
  });

  describe("One catalogue holds both kinds of source", () => {
    test("groups the shipped catalogue by kind", () => {
      const composed = composeCatalogue({ env: {}, signedIn: false });

      assert.deepEqual(ids(composed.mcp), ["solana", "explorer"]);
      assert.deepEqual(ids(composed.skill).slice(0, 2), [
        "playground-env",
        "solana-dev",
      ]);
    });

    test("Two entries share an id: the error names it", () => {
      const override = sources(server("solana", "https://solana.test/mcp"), {
        kind: "skill",
        id: "solana",
        name: "solana",
        description: "d",
        source: { type: "bundled" },
      });

      assert.throws(
        () => composeCatalogue({ env: {}, override, signedIn: false }),
        /duplicate id "solana"/
      );
    });

    test("rejects an unknown kind, naming the entry", () => {
      const override = sources({ kind: "tool", id: "x", name: "x" });

      assert.throws(
        () => composeCatalogue({ env: {}, override, signedIn: true }),
        /SOURCES entry 1 \("x"\): "kind"/
      );
    });
  });
});
