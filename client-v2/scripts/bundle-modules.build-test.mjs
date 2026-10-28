// A test helper imported statically ships code with no test title in it, so in-source-tests.build-test.mjs cannot see it
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  MODULES_FILE as FILE,
  offendingModules,
  unlistedConcatenatedRoots,
} from "./lib/bundle/modules.mjs";

const INDEX = path.join(import.meta.dirname, "..", "build", "index.html");

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
  const names = JSON.parse(text);
  assert.notEqual(names.length, 0, `${FILE} lists no module`);
  const unlisted = unlistedConcatenatedRoots(names);
  assert.equal(
    unlisted.length,
    0,
    `${FILE} lists concatenated modules without their nested modules (nestedModules in BundleModulesPlugin, craco.config.js), so a concatenated test helper would pass unseen:\n${unlisted.join(
      "\n"
    )}`
  );

  const offenders = offendingModules(names);
  assert.equal(
    offenders.length,
    0,
    `the production bundle carries test-only modules; import them only from tests:\n${offenders.join(
      "\n"
    )}`
  );
});
