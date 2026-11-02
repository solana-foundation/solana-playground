// Plain Node, as Vercel runs `api/*.mjs`: no bundler, no `@/`, no TypeScript.
// Imported through `server.mjs`, so these cases also prove the server door
// loads as it is deployed; vitest resolves through vite and could not.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BUILTIN_TOOLS } from "../server.mjs";

describe("BUILTIN_TOOLS", () => {
  test("declares every built-in tool once, in the order the model sees them", () => {
    assert.deepEqual(
      BUILTIN_TOOLS.map((tool) => tool.name),
      [
        "list_skills",
        "load_skill",
        "read_skill_reference",
        "list_files",
        "read_file",
        "get_build_error",
        "write_file",
        "build",
        "deploy",
      ]
    );
  });

  test("gives each tool a description and a closed object schema", () => {
    for (const { name, description, schema } of BUILTIN_TOOLS) {
      assert.notEqual(description.trim(), "", name);
      assert.equal(schema.type, "object", name);
      assert.equal(schema.additionalProperties, false, name);
      for (const key of schema.required ?? []) {
        assert.ok(key in schema.properties, `${name} requires ${key}`);
      }
    }
  });

  test("marks exactly the tools that change state as needing approval", () => {
    assert.deepEqual(
      BUILTIN_TOOLS.filter((tool) => tool.approval).map((tool) => tool.name),
      ["write_file", "build", "deploy"]
    );
  });
});
