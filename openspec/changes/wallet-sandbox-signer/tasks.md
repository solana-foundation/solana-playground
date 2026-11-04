# Tasks

## 1. The sandbox page and its headers

- [ ] 1.1 Add `runtime.html` as a second webpack entry in `craco.config.js` with the sandbox half of the runtime as its only chunk, and verify `yarn build-fast` emits `runtime.html` and its chunk
- [x] 1.2 Serve `runtime.html` with COEP `require-corp` and `/static/*` with `Cross-Origin-Resource-Policy: cross-origin` in `vercel.json` and the dev server, and verify with `curl -I` against the dev server that both headers are present
- [x] 1.3 Load the frame with `sandbox="allow-scripts"`, open the `MessageChannel` handshake, and report a load that takes over 15 s in the terminal; verify with a unit test of the handshake (foreign `window` messages ignored) and the scenario "The sandbox page fails to load" (manual)

## 2. The message protocol

- [x] 2.1 Define the typed protocol module (`run`, `output`, `result`, `end`, `sign`, `rpc`, `ready`) imported by both halves, and verify with a unit test that no message type has a field that can hold key bytes beyond a signature

## 3. Running code in the sandbox

- [x] 3.1 Move execution into the sandbox: the page transpiles and sends the code, IDL, `PROGRAM_ID`, endpoint and wallets; the sandbox builds `pg`, the packages and `console`, runs the code and posts output and `end`; verify `wallet-sandbox-signer`'s "The default client runs", "Imports resolve inside the sandbox" and "A syntax error ends the run" as Playwright tests
- [ ] 3.2 Run mocha inside the sandbox with a reporter that posts lines and counts; verify "A failing test is reported" and "Anchor workspace and program are ready" as Playwright tests, and update `js-runtime.test.ts`
- [x] 3.3 Bridge RPC through the page's `fetch`; verify "A script runs against Playnet" as a Playwright test
- [ ] 3.4 Remove the in-page runtime path and the substring blacklist, and verify `yarn test-types` and `yarn lint` pass with no reference left to the removed code

## 4. Signing from the sandbox

- [ ] 4.1 Add the sandbox signer provider and the page's sign handler (local provider for `pg.wallet`, the standard wallet for `pg.wallets.<name>`), and verify with unit tests "pg.wallet signs from the sandbox", "A sign request for an account the page does not hold" and "No message to the sandbox carries the key"
- [ ] 4.2 Make `pg.wallet.keypair` a keypair-shaped object whose `secretKey` throws a named error, and verify "Reading the secret key" as a Playwright test
- [ ] 4.3 Patch the sandbox's web3 `sign`, `partialSign`, `VersionedTransaction.sign`, `serialize` and the send and simulate methods for placeholders, and verify each patched method in unit tests plus "The hello-solana client signs with tx.sign", "sendAndConfirmTransaction with pg.wallet.keypair", "A v0 transaction signed with pg.wallet.keypair", "Anchor's payer signs an instruction", "The native template's test passes" and "Another signer alongside the wallet" as Playwright tests on Playnet
- [x] 4.4 Update `e2e/wallet-signing.e2e.spec.ts` to `await tx.sign(...)` before `verifySignatures`, and verify "Project code signs with pg.wallet.keypair" passes

## 5. Isolation

- [x] 5.1 Verify "A sandboxed script cannot read the page's storage", "A sandboxed script cannot reach the page", "A sandboxed script cannot find the key on pg" and "Messages from elsewhere are ignored" as Playwright tests

## 6. Docs

- [ ] 6.1 Explain the `secretKey` error and `await tx.sign(...)` in `docs/assistant-context.md`, run `yarn sync-assistant-context`; verify `yarn run check` passes
- [ ] 6.2 Explain the new bundle row in the PR description after `yarn bundle:info`; verify `yarn test-build` passes
