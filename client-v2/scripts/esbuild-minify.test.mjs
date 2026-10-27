import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import vm from "node:vm";

import { esbuildMinifyOptions } from "./esbuild-minify.mjs";

const require = createRequire(import.meta.url);
const TerserPlugin = require("terser-webpack-plugin");

/** A chunk as the production build minifies it */
const minify = async (name, code) => {
  const { code: out } = await TerserPlugin.esbuildMinify(
    { [name]: code },
    undefined,
    esbuildMinifyOptions()
  );
  return out;
};

describe("esbuildMinifyOptions", () => {
  // Chunks are classic scripts sharing one global scope. `keepNames` puts its
  // helpers at a chunk's top level, where they would be globals, and the same
  // minified name (say `o`) can be `Object.defineProperty` in one chunk and
  // the name setter in another: a chunk loaded later could swap out another
  // chunk's helper, and its next `o(fn, "name")` would call
  // `Object.defineProperty` without a descriptor. Two chunks of one shape
  // minify to the same names in the same roles and so cannot reproduce that
  // crash; the test checks that nothing leaks into the global scope instead.
  it("keeps each chunk's keepNames helpers out of the global scope", async () => {
    const chunk = (label) => `"use strict";
      self.render${label} = () => {
        const getItemProps = (path) => ({ path });
        return getItemProps("a").path;
      };
      class Store${label} {}
      self.Store${label} = Store${label};`;
    const context = vm.createContext({});
    context.self = context;
    const before = Object.keys(context);
    vm.runInContext(await minify("a.js", chunk("A")), context);
    vm.runInContext(await minify("b.js", chunk("B")), context);

    assert.deepEqual(
      Object.keys(context).filter((key) => !before.includes(key)),
      ["renderA", "StoreA", "renderB", "StoreB"]
    );
    assert.equal(context.renderA(), "a");
    // The names are kept, which is what `keepNames` is there for
    assert.equal(context.StoreA.name, "StoreA");
  });
});
