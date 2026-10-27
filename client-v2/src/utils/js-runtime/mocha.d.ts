// The part of mocha's browser build that `js-runtime.ts` uses. `@types/mocha`
// is not installed: it declares `describe`, `it` and the hooks as globals of
// every program that imports "mocha", and its `it` (no `each`) shadowed
// vitest's in the tests. The BDD functions are read off `globalThis` instead,
// where `mocha.setup` puts them.
declare module "mocha" {
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
