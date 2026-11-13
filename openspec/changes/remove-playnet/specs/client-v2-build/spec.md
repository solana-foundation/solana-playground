## ADDED Requirements

### Requirement: The client-v2 bundle carries no Playnet package

`client-v2/package.json` SHALL NOT depend on `@solana-playground/playnet`, and
no chunk of the production build SHALL hold a module from it. Playnet's wasm
binary is built from Solana and rbpf forks the repository does not hold, so it
cannot be audited, rebuilt or patched.

#### Scenario: The production build holds no Playnet module (manual)

- **WHEN** `yarn build-fast` runs and `yarn test-build` reads its output
- **THEN** `scripts/bundle-modules.build-test.mjs` finds no module under
  `@solana-playground/playnet` and no `playnet_bg.wasm` asset
