# Tasks

All tasks land in #34 (HOO-2167). The code exists there; each task is ticked
once its check passes on the PR's head. Groups 1 to 4 may run in parallel;
group 5 depends on all of them.

## 1. Default paths build the real packages

- [ ] 1.1 Verify "Setting up a checkout": run `yarn setup` in `client-v2/`
      with `USE_WASM_STUBS` unset, then confirm
      `grep -l 0.0.0-stub wasm/*/pkg/package.json client-v2/node_modules/@solana-playground/*/package.json`
      prints nothing (HOO-2167)
- [ ] 1.2 Verify "A pull request into master" and "The wasm build is skipped":
      the `wasm`, `checks`, `build`, `e2e`, `e2e-report` and `gate` jobs of
      `client-v2.yml` report on the PR's head, and the `gate` step's results
      line shows `wasm: success` (HOO-2167)
- [ ] 1.3 Verify "The compose production stand-in": `docker compose --profile
      v2-prod up --build` serves the app after `check-build` prints
      `carries the real packages` (HOO-2167)

## 2. No stub in a deployment

- [ ] 2.1 Verify "The variable set on a deployment": `USE_WASM_STUBS=true bash
      scripts/vercel-install.sh` exits non-zero naming the variable, and
      `make -f Makefile.vercel` prod-fast refuses it too (HOO-2167)
- [ ] 2.2 Verify "A bundle built on a stub": the `bundleProblems` table in
      `scripts/wasm-stubs.test.mjs` passes under `yarn test-api`, and
      `scripts/vercel-build.sh`, `vercel.json`'s `buildCommand`, ends with
      `check-build build` (HOO-2167)

## 3. The stub opt-in

- [ ] 3.1 Verify "A value other than true": the `wasmStubsRequested` rows in
      `scripts/wasm-stubs.test.mjs` pass under `yarn test-api` (HOO-2167)
- [ ] 3.2 Verify "Setting up on the stubs by name": `yarn setup:with-stubs`
      writes six manifests with `0.0.0-stub` and compiles no Rust; then run
      `yarn setup` to return to the real packages (HOO-2167)
- [ ] 3.3 Verify "The stub workflow": dispatch `client-v2-with-stubs.yml` on
      the PR branch; it is green, its `wasm` job is skipped, and the bundle
      snapshot test reports skipped (HOO-2167)
- [ ] 3.4 Confirm the header of `wasm/stub-packages.sh` states that the script
      is not gated and names `setup-wasm.sh` as the gate (HOO-2167)

## 4. Scripts refuse unrequested stubs

- [ ] 4.1 Verify "Stubs left in node_modules" and "Real packages installed":
      the three `guard` rows in `scripts/wasm-stubs.test.mjs` pass under
      `yarn test-api`, and `start`, `dev`, `dev-cra`, `build-fast` and
      `test-e2e` in `package.json` each run `wasm-stubs.mjs guard` first
      (HOO-2167)

## 5. The bundle snapshot

Depends on 1.1: the build must be on the real packages.

- [ ] 5.1 Verify "Refreshing the snapshot from a stub build" and "The
      snapshot test on a stub run": `yarn bundle:info` runs `check-build`
      before writing, and `USE_WASM_STUBS=true node --test
      scripts/bundle-info.build-test.mjs` reports the test skipped (HOO-2167)
- [ ] 5.2 Run `yarn spec:validate` and confirm `real-wasm-packages` passes
      strict validation (HOO-2167)
