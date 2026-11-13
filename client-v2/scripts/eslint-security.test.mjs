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
    "fails a dynamic innerHTML assignment",
    {
      file: "src/utils/probe.ts",
      code: "export const set = (el: HTMLElement, value: string) => {\n  el.innerHTML = value;\n};\n",
      rule: "no-unsanitized/property",
    },
    ERROR,
  ],
  [
    "fails postMessage to any origin",
    {
      file: "src/utils/probe.ts",
      code: 'export const post = (d: unknown) => window.parent.postMessage(d, "*");\n',
      rule: "@microsoft/sdl/no-postmessage-star-origin",
    },
    ERROR,
  ],
  [
    "accepts a loopback URL",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(LOOPBACK_URL.LOCALHOST),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    undefined,
  ],
  [
    "accepts a loopback URL with a path after the port",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(LOOPBACK_URL.LOCALHOST_WITH_PATH),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    undefined,
  ],
  [
    "accepts the IPv4 loopback address",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(LOOPBACK_URL.IPV4),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    undefined,
  ],
  [
    "fails localhost as userinfo before another host",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(NOT_LOOPBACK_URL.LOCALHOST_AS_USERINFO),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    ERROR,
  ],
  [
    "fails a host that only starts with localhost",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(NOT_LOOPBACK_URL.HOST_STARTING_WITH_LOCALHOST),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    ERROR,
  ],
  [
    "fails 0.0.0.0, which is not loopback",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(NOT_LOOPBACK_URL.UNSPECIFIED_ADDRESS),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    ERROR,
  ],
  [
    "fails an insecure URL in e2e/",
    {
      file: "e2e/probe.ts",
      code: exportingUrl(NOT_LOOPBACK_URL.REMOTE),
      rule: "@microsoft/sdl/no-insecure-url",
    },
    ERROR,
  ],
  [
    "fails a cluster's address in src/",
    {
      file: "src/utils/probe.ts",
      code: exportingUrl(DEVNET),
      rule: "no-restricted-syntax",
    },
    ERROR,
  ],
  [
    "fails a cluster's address in a layers file",
    {
      file: "src/features/probe/model/probe.ts",
      code: exportingUrl(DEVNET),
      rule: "no-restricted-syntax",
    },
    ERROR,
  ],
  [
    "fails a cluster's address in JSX text",
    {
      file: "src/utils/probe.tsx",
      code: `export const Probe = () => <p>${DEVNET}</p>;\n`,
      rule: "no-restricted-syntax",
    },
    ERROR,
  ],
  [
    "fails a cluster's address in a template literal in e2e/",
    {
      file: "e2e/probe.ts",
      code: `export const url = \`${DEVNET}/\${"rpc"}\`;\n`,
      rule: "no-restricted-syntax",
    },
    ERROR,
  ],
  [
    "fails a cluster's address in scripts/",
    {
      file: "scripts/probe.mjs",
      code: exportingUrl(DEVNET),
      rule: "no-restricted-syntax",
    },
    ERROR,
  ],
  [
    "accepts a cluster's address in the Endpoint module",
    {
      file: "src/entities/cluster/model/endpoint.ts",
      code: exportingUrl(DEVNET),
      rule: "no-restricted-syntax",
    },
    undefined,
  ],
  [
    "fails import() of a computed specifier outside the factories",
    {
      file: "src/utils/probe.ts",
      code: "export const load = (userUrl: string) => import(userUrl);\n",
      rule: "no-unsanitized/method",
    },
    ERROR,
  ],
  [
    "reports a dynamic RegExp in api/",
    {
      file: "api/probe.mjs",
      code: "export const pattern = (input) => new RegExp(input);\n",
      rule: "security/detect-non-literal-regexp",
    },
    WARNING,
  ],
  [
    "reports a dynamic RegExp in src/",
    {
      file: "src/utils/probe.ts",
      code: "export const pattern = (input: string) => new RegExp(input);\n",
      rule: "security/detect-non-literal-regexp",
    },
    WARNING,
  ],
  [
    "ignores a computed property read",
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
