// A test helper imported statically ships code with no test title in it, so in-source-tests.build-test.mjs cannot see it
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { MODULES_FILE, offendingModules } from "./bundle-modules.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const FILE = path.join(ROOT, MODULES_FILE);
const INDEX = path.join(ROOT, "build", "index.html");

test("the bundle holds no test helper or test runner module", async () => {
  const text = await fs.readFile(FILE, "utf8").catch((e) => {
    if (e.code === "ENOENT") {
      assert.fail(
        `no ${FILE}: run yarn build-fast first (BundleModulesPlugin in craco.config.js writes it, and logs why when it cannot)`
      );
    }
    throw e;
  });
  // A build without the plugin leaves an older build's list behind
  const [list, index] = await Promise.all([fs.stat(FILE), fs.stat(INDEX)]);
  assert.ok(
    list.mtimeMs >= index.mtimeMs,
    `${FILE} is older than ${INDEX}: the last production build did not write it (BundleModulesPlugin in craco.config.js)`
  );
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
