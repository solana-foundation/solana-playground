import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint, Linter, RuleTester } from "eslint";

const require = createRequire(import.meta.url);
const { rules } = require("eslint-plugin-layers");

const cwd = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(cwd, "src");

describe("eslint-plugin-layers", () => {
  it("fails a relative import that leaves its slice", async () => {
    const eslint = new ESLint({ cwd });
    const [result] = await eslint.lintText(
      'import { uuid } from "../../../shared/lib/ids";\nuuid;\n',
      { filePath: "src/widgets/home/model/probe.ts" }
    );
    const errors = result.messages.filter(
      (m) => m.ruleId === "layers/alias-across-modules"
    );
    assert.equal(errors.length, 1, JSON.stringify(result.messages));
    assert.equal(errors[0].severity, 2);
  });
});

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  parser: require.resolve("@typescript-eslint/parser"),
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// Files sit in real slices: whether `app/Effects` is a folder is read from disk
const valid = [
  ["widgets/home/ui/Probe.tsx", 'import * as t from "../model/telemetry";'],
  ["app/Probe.tsx", 'import * as f from "./favicon";'],
  ["widgets/home/ui/Probe.tsx", 'import D from "../../../components/Delayed";'],
  ["components/Probe.tsx", 'import { uuid } from "../shared/lib/ids";'],
  [
    "widgets/home/model/probe.mjs",
    'import * as t from "../../../shared/lib/telemetry";',
  ],
  ["widgets/home/model/probe.ts", "export const x = 1;"],
].map(([file, code]) => ({
  filename: path.join(src, file),
  code,
  options: [{ src }],
}));

const invalid = [
  [
    "widgets/home/model/probe.ts",
    'import { createTracker } from "../../../shared/lib/telemetry";',
    'import { createTracker } from "@/shared/lib/telemetry";',
    { from: "widgets/home", to: "shared/lib", alias: "@/shared/lib/telemetry" },
  ],
  [
    "shared/lib/probe.ts",
    'export { Button } from "../ui/button";',
    'export { Button } from "@/shared/ui/button";',
  ],
  [
    "shared/probe.ts",
    'export * from "./lib/ids";',
    'export * from "@/shared/lib/ids";',
  ],
  [
    "app/Probe.tsx",
    "const load = () => import('./Effects');",
    "const load = () => import('@/app/Effects');",
  ],
  [
    "app/Panels/Probe.tsx",
    'import { App } from "../App";',
    'import { App } from "@/app/App";',
  ],
  [
    "features/agent/probe.ts",
    'import * as program from "../../entities/program";',
    'import * as program from "@/entities/program";',
  ],
  [
    "shared/lib/probe.test.mts",
    'import { Button } from "../ui/button";',
    'import { Button } from "@/shared/ui/button";',
  ],
  [
    "features/agent/probe.test.ts",
    'vi.mock("../auth/server.mjs");',
    'vi.mock("@/features/auth/server.mjs");',
  ],
  [
    "features/agent/probe.test.ts",
    'vi.doMock("../auth");',
    'vi.doMock("@/features/auth");',
  ],
  [
    "features/agent/probe.test.ts",
    'vi.unmock("../auth");',
    'vi.unmock("@/features/auth");',
  ],
  [
    "features/agent/probe.test.ts",
    'vi.doUnmock("../auth");',
    'vi.doUnmock("@/features/auth");',
  ],
  [
    "features/agent/probe.test.ts",
    'const real = await vi.importActual("../feedback");',
    'const real = await vi.importActual("@/features/feedback");',
  ],
  [
    "features/agent/probe.test.ts",
    'const mocked = await vi.importMock("../feedback");',
    'const mocked = await vi.importMock("@/features/feedback");',
  ],
  [
    "features/agent/probe.ts",
    'type Auth = typeof import("../auth/index");',
    'type Auth = typeof import("@/features/auth/index");',
  ],
  [
    "features/agent/probe.ts",
    'const ids = require("../../shared/lib/ids");',
    'const ids = require("@/shared/lib/ids");',
  ],
  [
    "features/agent/probe.ts",
    'import ids = require("../../shared/lib/ids");',
    'import ids = require("@/shared/lib/ids");',
  ],
  [
    "features/agent/probe.test.ts",
    "vi.mock(`../auth`);",
    "vi.mock(`@/features/auth`);",
  ],
  // The fix writes the path back escaped for the delimiter it keeps
  [
    "features/agent/probe.ts",
    "import x from '../auth/it\\'s';",
    "import x from '@/features/auth/it\\'s';",
  ],
  [
    "features/agent/probe.test.ts",
    "vi.mock(`../auth/a\\`b\\${c`);",
    "vi.mock(`@/features/auth/a\\`b\\${c`);",
  ],
].map(([file, code, output, data]) => ({
  filename: path.join(src, file),
  code,
  output,
  options: [{ src }],
  errors: [
    data === undefined ? { messageId: "alias" } : { messageId: "alias", data },
  ],
}));

tester.run("layers/alias-across-modules", rules["alias-across-modules"], {
  valid,
  invalid,
});

describe("layers/alias-across-modules options", () => {
  // A wrong `src` would place no file in a layer and pass everything
  for (const wrong of ["src", path.join(src, "missing")]) {
    it(`throws for src "${wrong}"`, () => {
      const linter = new Linter();
      linter.defineRule("alias-across-modules", rules["alias-across-modules"]);
      assert.throws(
        () =>
          linter.verify(
            "x;",
            { rules: { "alias-across-modules": ["error", { src: wrong }] } },
            { filename: path.join(src, "shared/probe.ts") }
          ),
        /must be an absolute path to an existing directory/
      );
    });
  }
});
