// The design system's registry must install from the repo alone: the shadcn
// CLI resolves a bare dependency name (`button`) against ui.shadcn.com, and
// an undeclared import lands a file that imports a file that never landed,
// or a package the install never added.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../design-system"
);
const registry = JSON.parse(
  readFileSync(path.join(DS, "registry.json"), "utf8")
);
const NAMESPACE = "@playground/";
const names = new Set(registry.items.map((item) => item.name));

test("every registry dependency is in the playground namespace", () => {
  const bare = registry.items.flatMap((item) =>
    (item.registryDependencies ?? [])
      .filter((dep) => !dep.startsWith(NAMESPACE))
      .map((dep) => `${item.name} -> ${dep}`)
  );
  assert.deepEqual(bare, []);
});

test("every playground dependency names an item", () => {
  const missing = registry.items.flatMap((item) =>
    (item.registryDependencies ?? [])
      .filter((dep) => dep.startsWith(NAMESPACE))
      .filter((dep) => !names.has(dep.slice(NAMESPACE.length)))
      .map((dep) => `${item.name} -> ${dep}`)
  );
  assert.deepEqual(missing, []);
});

// `from "x"` and a bare `import "x"`, in either quote.
const IMPORT = /(?:from|import)\s*["']([^"']+)["']/g;
// What an item file may import from the registry: one item by name.
const ITEM_IMPORT = /^@\/(?:components\/ui|hooks)\/([a-z0-9-]+)$/;
// The consumer brings React; every other package is the item's to declare.
const PROVIDED = new Set(["react", "react-dom"]);

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function importsOf(item) {
  return (item.files ?? []).flatMap((file) =>
    Array.from(
      readFileSync(path.join(DS, file.path), "utf8").matchAll(IMPORT),
      (match) => match[1]
    )
  );
}

test("every import of an item's files is declared by the item", () => {
  const imports = registry.items.flatMap((item) =>
    importsOf(item).map((specifier) => ({ item, specifier }))
  );
  // A pattern that stops matching would pass every item unchecked.
  assert.ok(imports.length > 0, "no import matched in any item file");

  const undeclared = imports
    .filter(({ item, specifier }) => {
      const component = specifier.match(ITEM_IMPORT);
      if (component) {
        return !(item.registryDependencies ?? []).includes(
          `${NAMESPACE}${component[1]}`
        );
      }
      // Any other alias or a relative path names a file the item never ships.
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        return true;
      }
      const name = packageName(specifier);
      return !PROVIDED.has(name) && !(item.dependencies ?? []).includes(name);
    })
    .map(({ item, specifier }) => `${item.name} -> ${specifier}`);
  assert.deepEqual(undeclared, []);
});
