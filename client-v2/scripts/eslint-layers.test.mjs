import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const cwd = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const layersConfig = createRequire(import.meta.url)("../eslint-layers.js");

/** The imports `ui-migration` task 1.4 removes, by file */
const RECORDED_IMPORTS = {
  "src/features/auth/model/auth.mjs": "../../persistence/server.mjs",
  "src/features/persistence/model/chat-sync.ts": "@/features/auth",
  "src/features/persistence/model/project-sync.ts": "@/features/auth",
  "src/features/persistence/model/sync-base.ts": "@/features/auth",
  "src/features/persistence/model/sync-claim.ts": "@/features/auth",
  "src/features/persistence/model/sync-mark.ts": "@/features/auth",
  "src/features/persistence/model/project-restore.test.ts": "@/features/auth",
  "src/features/persistence/model/project-sync.test.ts": "@/features/auth",
  "src/features/persistence/model/two-devices.test.ts": "@/features/auth",
};

const LAYER_RULES = new Set([
  "boundaries/dependencies",
  "layers/recorded-exception",
]);

/**
 * The layer rule's messages for `code` linted with `package.json`
 * `eslintConfig`, which `yarn lint` and `yarn lint:layers` both read, as if
 * it lived at `file`. The file does not exist, but it sits in a real slice,
 * so its imports resolve to real files the way they would in the code; an
 * import that resolves to nothing is not checked, so a broken resolver shows
 * here as violations that pass.
 */
const layerMessages = async (file, code) => {
  const eslint = new ESLint({ cwd });
  const [result] = await eslint.lintText(code, { filePath: file });
  return result.messages.filter((m) => LAYER_RULES.has(m.ruleId));
};

const VIOLATIONS = [
  {
    name: "a widget importing a widget by a relative path",
    file: "src/widgets/assistant/ui/Probe.tsx",
    code: 'import { ModalHost } from "../../overlays";\nModalHost;\n',
    message: /widgets\/overlays is not allowed here/,
  },
  {
    name: "a feature importing a feature",
    file: "src/features/agent/model/probe.ts",
    code: 'import * as feedback from "@/features/feedback";\nfeedback;\n',
    message: /features\/feedback is not allowed here/,
  },
  {
    name: "shared importing a feature",
    file: "src/shared/lib/probe.ts",
    code: 'import * as feedback from "@/features/feedback";\nfeedback;\n',
    message: /shared may import only the layers below it/,
  },
  {
    name: "a deep import past a slice's public entry",
    file: "src/widgets/home/ui/Probe.tsx",
    code: 'import * as context from "@/features/feedback/model/context";\ncontext;\n',
    message: /through its public entry/,
  },
  {
    name: "a test importing another slice of its own layer",
    file: "src/widgets/assistant/ui/Probe.test.tsx",
    code: 'import { ModalHost } from "../../overlays";\nModalHost;\n',
    message: /widgets\/overlays is not allowed here/,
  },
  {
    name: "a deep import of a server module past server.mjs",
    file: "src/widgets/home/model/probe.mjs",
    code: 'import * as auth from "@/features/auth/model/auth.mjs";\nauth;\n',
    message: /through its public entry/,
  },
  {
    name: "browser code importing a slice's server.mjs",
    file: "src/widgets/home/ui/Probe.tsx",
    code: 'import * as auth from "@/features/auth/server.mjs";\nauth;\n',
    message: /server\.mjs is the door for server code/,
  },
  {
    name: "a feature importing a widget",
    file: "src/features/feedback/model/probe.ts",
    code: 'import * as home from "@/widgets/home";\nhome;\n',
    message: /features may import only the layers below it/,
  },
  {
    name: "an entity importing a feature",
    file: "src/entities/program/model/probe.ts",
    code: 'import * as feedback from "@/features/feedback";\nfeedback;\n',
    message: /entities may import only the layers below it/,
  },
  {
    name: "a widget importing app",
    file: "src/widgets/home/ui/Probe.tsx",
    code: 'import * as app from "@/app";\napp;\n',
    message: /widgets may import only the layers below it/,
  },
  {
    name: "an entity importing an entity",
    file: "src/entities/program/model/probe.ts",
    code: 'import * as tutorial from "../../tutorial";\ntutorial;\n',
    message: /entities\/tutorial is not allowed here/,
  },
  {
    name: "a route importing past a slice's server.mjs",
    file: "api/probe.mjs",
    code: 'import { readJson } from "../src/features/api/server/read-json.mjs";\nreadJson;\n',
    message: /api\/ reaches features\/api only through its server\.mjs/,
  },
  {
    name: "browser code importing a route",
    file: "src/widgets/home/ui/probe.ts",
    code: 'import handler from "../../../../api/agent.mjs";\nhandler;\n',
    message: /widgets may import only the layers below it/,
  },
  // The plugin checks every import spelling by default; these fail if a
  // `boundaries/dependency-nodes` setting ever narrows that
  {
    name: "a re-export from another slice",
    file: "src/widgets/assistant/ui/probe.ts",
    code: 'export * from "../../overlays";\n',
    message: /widgets\/overlays is not allowed here/,
  },
  {
    name: "a type-only import from another slice",
    file: "src/widgets/assistant/ui/probe.ts",
    code: 'import type { ModalHost } from "../../overlays";\nexport type Probe = typeof ModalHost;\n',
    message: /widgets\/overlays is not allowed here/,
  },
  {
    name: "a dynamic import of another slice",
    file: "src/widgets/assistant/ui/probe.ts",
    code: 'export const load = () => import("../../overlays");\n',
    message: /widgets\/overlays is not allowed here/,
  },
  {
    name: "persistence importing auth from a file outside the recorded exception",
    file: "src/features/persistence/model/probe.ts",
    code: 'import * as auth from "@/features/auth";\nauth;\n',
    message: /features\/auth is not allowed here/,
  },
  {
    name: "a file of the recorded exception importing a third feature",
    file: "src/features/persistence/model/sync-mark.ts",
    code: 'import * as feedback from "@/features/feedback";\nfeedback;\n',
    message: /features\/feedback is not allowed here/,
  },
  {
    name: "auth server code outside the recorded exception importing persistence",
    file: "src/features/auth/model/probe.mjs",
    code: 'import * as persistence from "../../persistence/server.mjs";\npersistence;\n',
    message: /features\/persistence is not allowed here/,
  },
  {
    name: "a file of the recorded exception importing past the other slice's entry",
    file: "src/features/persistence/model/sync-mark.ts",
    code: 'import * as session from "@/features/auth/model/session";\nsession;\n',
    message: /through its public entry/,
  },
];

const ALLOWED = [
  {
    name: "a file of the recorded exception importing inside its own slice",
    file: "src/features/persistence/model/sync-mark.ts",
    code: 'import { report } from "./diagnostics";\nreport;\n',
  },
  {
    name: "a widget importing a feature and shared through their entries",
    file: "src/widgets/home/ui/Probe.tsx",
    code: 'import * as feedback from "@/features/feedback";\nimport { uuid } from "@/shared/lib/ids";\nfeedback;\nuuid;\n',
  },
  {
    name: "a test's mock rebuilding a slice's entry from the modules behind it",
    file: "src/app/Probe.test.tsx",
    code: 'vi.mock("@/features/feedback", async () => ({\n  context: await import("@/features/feedback/model/context"),\n}));\n',
  },
  {
    name: "a route importing a slice's server.mjs and shared",
    file: "api/probe.mjs",
    code: 'import { readJson } from "../src/features/api/server.mjs";\nimport { agentEnv } from "../src/shared/config/server-env.mjs";\nreadJson;\nagentEnv;\n',
  },
  {
    name: "a slice's integration spec driving its route",
    file: "src/features/agent/probe.integration.spec.ts",
    code: 'import handler from "../../../api/agent.mjs";\nhandler;\n',
  },
  {
    name: "server code importing another slice's server.mjs",
    file: "src/widgets/home/model/probe.mjs",
    code: 'import * as auth from "../../../features/auth/server.mjs";\nauth;\n',
  },
  {
    name: "a slice importing a path inside itself",
    file: "src/widgets/home/ui/Probe.tsx",
    code: 'import * as telemetry from "../model/telemetry";\ntelemetry;\n',
  },
  // Passes whatever the rule does, since a file outside the layers is never
  // linted by it; it pins the decision to leave the legacy roots alone
  {
    name: "a legacy root importing a path inside a slice",
    file: "src/components/Probe.tsx",
    code: 'import * as context from "@/features/feedback/model/context";\ncontext;\n',
  },
];

// Editors and `npx eslint client-v2/...` lint from the repository root. The
// plugin and the resolver read `process.cwd()`, not ESLint's `cwd`, so the
// test moves the process there
describe("eslint-layers.js run from the repository root", () => {
  it("still places files in their layers", async () => {
    const root = path.dirname(cwd);
    const before = process.cwd();
    process.chdir(root);
    try {
      const eslint = new ESLint({ cwd: root });
      const [result] = await eslint.lintText(
        'import { ModalHost } from "../../overlays";\nModalHost;\n',
        { filePath: "client-v2/src/widgets/assistant/ui/Probe.tsx" }
      );
      const errors = result.messages.filter(
        (m) => m.ruleId === "boundaries/dependencies"
      );
      assert.equal(errors.length, 1, JSON.stringify(result.messages));
    } finally {
      process.chdir(before);
    }
  });
});

describe("eslint-layers.js", () => {
  for (const { name, file, code, message } of VIOLATIONS) {
    it(`fails ${name}`, async () => {
      const errors = await layerMessages(file, code);
      assert.equal(errors.length, 1, JSON.stringify(errors));
      assert.equal(errors[0].severity, 2);
      assert.match(errors[0].message, message);
    });
  }

  for (const { name, file, code } of ALLOWED) {
    it(`allows ${name}`, async () => {
      assert.deepEqual(await layerMessages(file, code), []);
    });
  }
});

// A new import across the pair, in a listed file or a newly listed one, or a
// listed file that stopped importing across, fails here
describe("the recorded exception", () => {
  it("warns on exactly the known imports and fails none", async () => {
    const files = layersConfig.overrides.find(
      (o) => "layers/recorded-exception" in o.rules
    ).files;
    const results = await new ESLint({ cwd }).lintFiles(files);
    const found = results.flatMap((result) =>
      result.messages
        .filter((m) => LAYER_RULES.has(m.ruleId))
        .map((m) => [
          path.relative(cwd, result.filePath),
          m.ruleId,
          m.severity,
          m.message.match(/imports "([^"]+)"/)?.[1],
        ])
    );
    const expected = Object.entries(RECORDED_IMPORTS).map(
      ([file, specifier]) => [file, "layers/recorded-exception", 1, specifier]
    );
    assert.deepEqual(found.sort(), expected.sort());
  });
});
