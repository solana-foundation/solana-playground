# Tasks

## 1. Take sugar out (HOO-2867)

Plan: [plans/1-remove-sugar.md](plans/1-remove-sugar.md)

- [x] 1.1 Drop `sugar` from `NEEDS_CONNECTION` in `client-v2/src/commands/needs-connection.test.ts` and watch "names
      every command in one list" fail; delete `client-v2/src/commands/sugar` and its `PgPackage` entry in
      `utils/package.ts`; the test passes and `yarn test-types` is green (HOO-2867)
- [x] 1.2 Delete `wasm/sugar-cli`; remove `sugar-cli` from `wasm/Cargo.toml`, `wasm/build.sh`,
      `wasm/stub-packages.sh`, `client-v2/package.json`, `client-v2/yarn.lock`, `client-v2/scripts/wasm-stubs.sh`,
      `wasm-stubs.mjs` (`REAL_WASM_MARKERS`), `wasm-stubs.test.mjs` and the `craco.config.js` chunk pattern; prune
      `wasm/Cargo.lock` with Cargo; verify `yarn install --frozen-lockfile` and `yarn test-api` pass and
      `grep -rn sugar` finds only the out-of-scope places named in the proposal (HOO-2867; depends on 1.1)
- [x] 1.3 Remove the `sugar --help` row of `client-v2/e2e/wasm-clis.e2e.spec.ts` (CI runs it on the real packages)
      (HOO-2867; depends on 1.2)
- [x] 1.4 Docs: `docs/assistant-context.md` then `yarn sync-assistant-context`, `docs/testing.md`, `CLAUDE.md`,
      `client-v2/README.md`; verify `yarn run check` is green (HOO-2867;
      depends on 1.2)
