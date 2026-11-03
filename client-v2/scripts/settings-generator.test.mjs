import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("src/settings under Node", () => {
  // Vitest runs in jsdom, where the browser globals exist, so only this run catches a module that reads one before `node-compatiblity` defines it
  it("prints the default settings the build reads into GLOBAL_SETTINGS", () => {
    const out = execFileSync(
      "yarn",
      ["run", "tsx", path.join("src", "settings"), "--no-warnings"],
      {
        cwd: CLIENT,
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
        encoding: "utf8",
      }
    );
    const settings = JSON.parse(out.split("---DEFAULT_SETTINGS---").at(1));

    assert.ok(Array.isArray(settings));
    assert.ok(settings.length > 0);
  });
});
