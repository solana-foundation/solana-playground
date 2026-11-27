import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { INDEX, lintGates, renderIndex } from "./lint-gates.mjs";

const gate = (frontmatter) =>
  `---\n${frontmatter}\n---\n\nA text never restates the code it names.\n`;

const withIndex = (path, text) => {
  const files = { [path]: text };
  files[INDEX] = renderIndex(files);
  return files;
};

describe("lintGates", () => {
  const cases = [
    [
      "accepts a weighted judgement gate",
      "writing/a.md",
      "weight: 0.8\ntest: judgement",
      [],
    ],
    [
      "rejects a weight off the scale",
      "writing/a.md",
      "weight: 0.5\ntest: judgement",
      ["writing/a", "weight"],
    ],
    [
      "rejects a gate without a test",
      "writing/a.md",
      "weight: 0.8",
      ["writing/a", "test"],
    ],
    [
      "rejects a 1.0 gate settled by judgement",
      "writing/a.md",
      "weight: 1.0\ntest: judgement",
      ["writing/a", "1.0"],
    ],
    [
      "rejects a gate outside a topic directory",
      "a.md",
      "weight: 0.8\ntest: judgement",
      ["a.md", "topic"],
    ],
  ];

  for (const [title, path, frontmatter, expected] of cases) {
    it(title, () => {
      const errors = lintGates(withIndex(path, gate(frontmatter)));
      if (expected.length === 0) {
        assert.deepEqual(errors, []);
        return;
      }
      assert.equal(errors.length, 1);
      for (const fragment of expected)
        assert.ok(errors[0].includes(fragment), errors[0]);
    });
  }

  it("rejects an index that misses a gate", () => {
    const files = withIndex("writing/a.md", gate("weight: 0.8\ntest: judgement"));
    files["writing/b.md"] = gate("weight: 0.4\ntest: judgement");
    const errors = lintGates(files);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes(INDEX), errors[0]);
  });
});

describe("renderIndex", () => {
  it("carries each gate's id, weight, test, and rule", () => {
    const index = renderIndex({
      "writing/a.md": gate("weight: 0.8\ntest: judgement"),
      "README.md": "# Gates\n",
    });
    assert.ok(
      index.includes(
        "## writing/a\n\nweight: 0.8 · test: judgement\n\nA text never restates the code it names."
      ),
      index
    );
    assert.ok(!index.includes("# Gates"), index);
  });
});
