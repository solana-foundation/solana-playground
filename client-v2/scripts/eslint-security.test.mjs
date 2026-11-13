import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { untypedEslintAt } from "./lib/untyped-eslint.mjs";

const cwd = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const ERROR = 2;
const WARNING = 1;

/** The severity `rule` reports `code` with, linted as if it lived at `file`; undefined when it reports nothing */
const severityOf = async ({ file, code, rule }) => {
  const [result] = await untypedEslintAt(cwd).lintText(code, {
    filePath: file,
  });
  assert.deepEqual(
    result.messages.filter((m) => m.ruleId === null),
    [],
    "the probe parsed and was linted"
  );
  return result.messages.find((m) => m.ruleId === rule)?.severity;
};

const PROBES = [
  [
    "security-checks: A dynamic innerHTML assignment",
    {
      file: "src/utils/probe.ts",
      code: "export const set = (el: HTMLElement, value: string) => {\n  el.innerHTML = value;\n};\n",
      rule: "no-unsanitized/property",
    },
    ERROR,
  ],
  [
    "security-checks: A literal assignment",
    {
      file: "src/utils/probe.ts",
      code: 'export const clear = (el: HTMLElement) => {\n  el.innerHTML = "";\n};\n',
      rule: "no-unsanitized/property",
    },
    undefined,
  ],
  [
    "security-checks: postMessage to any origin",
    {
      file: "src/utils/probe.ts",
      code: 'export const post = (d: unknown) => window.parent.postMessage(d, "*");\n',
      rule: "@microsoft/sdl/no-postmessage-star-origin",
    },
    ERROR,
  ],
  [
    "security-checks: A loopback URL",
    {
      file: "src/utils/probe.ts",
      code: 'export const url = "http://localhost:3000";\n',
      rule: "@microsoft/sdl/no-insecure-url",
    },
    undefined,
  ],
  [
    "a host that only starts with localhost is not loopback",
    {
      file: "src/utils/probe.ts",
      code: 'export const url = "http://localhost.evil.test";\n',
      rule: "@microsoft/sdl/no-insecure-url",
    },
    ERROR,
  ],
  [
    "0.0.0.0 is not loopback",
    {
      file: "src/utils/probe.ts",
      code: 'export const url = "http://0.0.0.0:8899";\n',
      rule: "@microsoft/sdl/no-insecure-url",
    },
    ERROR,
  ],
  [
    "e2e/ is checked for insecure URLs",
    {
      file: "e2e/probe.ts",
      code: 'export const url = "http://example.test";\n',
      rule: "@microsoft/sdl/no-insecure-url",
    },
    ERROR,
  ],
  [
    "import() of a computed specifier outside the factories is checked",
    {
      file: "src/utils/probe.ts",
      code: "export const load = (userUrl: string) => import(userUrl);\n",
      rule: "no-unsanitized/method",
    },
    ERROR,
  ],
  [
    "security-checks: A dynamic RegExp",
    {
      file: "api/probe.mjs",
      code: "export const pattern = (input) => new RegExp(input);\n",
      rule: "security/detect-non-literal-regexp",
    },
    WARNING,
  ],
  [
    "security-checks: A computed property read",
    {
      file: "src/utils/probe.ts",
      code: "export const read = (r: Record<string, number>, key: string) => r[key];\n",
      rule: "security/detect-object-injection",
    },
    undefined,
  ],
];

// node:test has no it.each; one table, one test per row
describe("eslint.config.mjs security rules", () => {
  for (const [name, probe, expected] of PROBES) {
    it(name, async () => {
      assert.equal(await severityOf(probe), expected);
    });
  }
});
