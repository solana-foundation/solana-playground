import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LOOPBACK_URL,
  NOT_LOOPBACK_URL,
} from "../src/test-utils/endpoints.mjs";
import { untypedEslintAt } from "./lib/untyped-eslint.mjs";

const cwd = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const ERROR = 2;
const WARNING = 1;

/** A module that exports `url` */
const exportingUrl = (url) => `export const url = ${JSON.stringify(url)};\n`;

// eslint-disable-next-line no-restricted-syntax -- the address the cluster-URL rule must refuse
const DEVNET = "https://api.devnet.solana.com";

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
      code: exportingUrl(LOOPBACK_URL.LOCALHOST),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    undefined,
  ],
  [
    "a loopback URL with a path after the port",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(LOOPBACK_URL.LOCALHOST_WITH_PATH),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    undefined,
  ],
  [
    "the IPv4 loopback address",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(LOOPBACK_URL.IPV4),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    undefined,
  ],
  [
    "localhost as userinfo before another host is not loopback",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(NOT_LOOPBACK_URL.LOCALHOST_AS_USERINFO),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    ERROR,
  ],
  [
    "a host that only starts with localhost is not loopback",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(NOT_LOOPBACK_URL.HOST_STARTING_WITH_LOCALHOST),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    ERROR,
  ],
  [
    "0.0.0.0 is not loopback",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(NOT_LOOPBACK_URL.UNSPECIFIED_ADDRESS),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    ERROR,
  ],
  [
    "e2e/ is checked for insecure URLs",
    {
      file: "e2e/probe.ts",
      code: exportingUrl(NOT_LOOPBACK_URL.REMOTE),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    ERROR,
  ],
  [
    "a cluster's address spelled in src/ is refused",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(DEVNET),
      rule: "no-restricted-syntax",
    },
    ERROR,
  ],
  [
    "a cluster's address in a template literal in e2e/ is refused",
    {
      file: "e2e/probe.ts",
      code: `export const url = \`${DEVNET}/\${"rpc"}\`;\n`,
      rule: "no-restricted-syntax",
    },
    ERROR,
  ],
  [
    "a cluster's address spelled in scripts/ is refused",
    {
      file: "scripts/probe.mjs",
      code: exportingUrl(DEVNET),
      rule: "no-restricted-syntax",
    },
    ERROR,
  ],
  [
    "the Endpoint module may spell a cluster's address",
    {
      file: "src/entities/cluster/model/endpoint.ts",
      code: exportingUrl(DEVNET),
      rule: "no-restricted-syntax",
    },
    undefined,
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
