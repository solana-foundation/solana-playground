// A test helper imported statically ships code with no test title in it, so in-source-tests.build-test.mjs cannot see it
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { MODULES_FILE, offendingModules } from "./bundle-modules.mjs";

const FILE = path.join(import.meta.dirname, "..", "build", MODULES_FILE);

test("the bundle holds no test helper or test runner module", async () => {
  const text = await fs.readFile(FILE, "utf8").catch((e) => {
    if (e.code === "ENOENT") {
      assert.fail(
        `no ${FILE}: run yarn build-fast first (BundleModulesPlugin in craco.config.js writes it)`
      );
    }
    throw e;
  });
  const modules = JSON.parse(text);
  assert.notEqual(modules.length, 0, `${FILE} lists no module`);

  const offenders = offendingModules(modules);
  assert.equal(
    offenders.length,
    0,
    `the production bundle carries test-only modules; import them only from tests:\n${offenders.join(
      "\n"
    )}`
  );
});
