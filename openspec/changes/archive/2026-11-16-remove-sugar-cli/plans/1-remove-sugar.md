# Plan: take sugar out (task 1)

Goal: no `sugar` command and no `sugar-cli` wasm package, in the shape #163 used for `anchor-cli`.

1. Red: remove `"sugar"` from `NEEDS_CONNECTION` in `client-v2/src/commands/needs-connection.test.ts`; run
   `yarn vitest run src/commands/needs-connection.test.ts`, expect "names every command in one list" to fail.
2. Green: `git rm -r client-v2/src/commands/sugar`; drop the `sugar-cli` type and `case` in `utils/package.ts`;
   `yarn generate-fast` (regenerates the command registry); rerun the test, expect pass; `yarn test-types`.
3. Packages: `git rm -r wasm/sugar-cli`; remove it from `wasm/Cargo.toml` members, `wasm/build.sh`
   `all_packages`, `wasm/stub-packages.sh`, `client-v2/package.json`, `WASM_PACKAGES` in `wasm-stubs.sh`,
   `REAL_WASM_MARKERS` in `wasm-stubs.mjs`, the fixture in `wasm-stubs.test.mjs`, the `craco.config.js` pattern.
   Remove the `@solana-playground/sugar-cli` block from `yarn.lock`; `yarn install --frozen-lockfile` must pass.
   Prune `wasm/Cargo.lock` with `cargo metadata --offline` in `wasm/`; diff must only delete packages.
4. e2e: remove the `sugar` row of `wasm-clis.e2e.spec.ts` (CI's `@real-wasm` job runs it).
5. Docs: `docs/assistant-context.md` + `yarn sync-assistant-context`, `docs/testing.md`, `CLAUDE.md`,
   `client-v2/README.md`, `wasm/stub-packages.sh` header.
6. Gate: `yarn run check`, `yarn test-api`, `grep -rn -i sugar` outside the out-of-scope list.
