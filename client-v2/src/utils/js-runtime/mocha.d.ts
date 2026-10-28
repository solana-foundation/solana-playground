// The part of mocha's browser build that `js-runtime.ts` uses, imported as
// "mocha/browser-entry", the file webpack picks for "mocha" anyway. That path
// has no types of its own, so this declaration applies and `@types/mocha` stays
// out of the program: it declares `describe`, `it` and the hooks as globals of
// any program that imports "mocha", and its `it` (no `each`) shadowed vitest's
// in the tests. The package stays installed because
// `scripts/generate-packages.mjs` ships its types to the editor for user test
// programs. The BDD functions are read off `globalThis` instead, where
// `mocha.setup` puts them.
declare module "mocha/browser-entry" {
  /** `"init"` once set up, `"running"` while a run is in progress */
  export const _state: string;
  export const suite: { suites: unknown[]; tests: unknown[] };
  export function setup(options: {
    ui: "bdd";
    timeout: string;
    cleanReferencesAfterRun: boolean;
    reporter: string;
  }): void;
  export function run(): unknown;
}
