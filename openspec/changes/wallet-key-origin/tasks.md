Plan: [plans/1-wallet-key-origin.md](plans/1-wallet-key-origin.md)

## 1. Key page

- [x] 1.1 Protocol: request/reply types, validators, protocol version, `loopback` origin resolution (`key-origin/protocol.ts`, `key-origin/origin.ts`) (HOO-2680)
- [x] 1.2 Key store on the key origin: IndexedDB `pg-wallet-keys` by public key, Web Lock, no drafts (`key-origin/frame/store.ts`) (HOO-2680)
- [x] 1.3 Key page handler: handshake with origin check, `accounts`, `create`, `sign` (transaction / message, message-that-is-a-transaction refused), `forget`, `adopt` (`key-origin/frame/handler.ts`) (HOO-2680)
- [x] 1.4 Entry and page `wallet-keys.html` in `craco.config.js`; CSP, COEP/CORP and the `wallet-keys` host rule in `vercel.json`; dev-server headers (HOO-2680)

## 2. Page side

- [x] 2.1 Key frame client: hidden frame, bounded handshake, request ids, `unavailable` on timeout or version mismatch (`key-origin/client.ts`) (HOO-2680)
- [x] 2.2 Key-origin signer provider from the sandbox signer; `getKeypairBytes` and `secretKeyFor` refuse with the CLI message (HOO-2680)
- [x] 2.3 Account record `{ name, publicKey }` under the key-origin provider; `add`, dedupe and `publicKeyOf` read `publicKey` (HOO-2680)
- [x] 2.4 One-time move: copy, confirm, drop, under the cross-tab lock; logged without key material (HOO-2680)
- [x] 2.5 Provider chosen at boot from `REACT_APP_WALLET_KEY_ORIGIN` (HOO-2680)

## 3. Dialogs

- [x] 3.1 Setup and Add: key made and stored in the key page at once, forgotten if the dialog closes without adding (HOO-2680)
- [x] 3.2 Import and export panels of the key page in Setup, Add, Settings and Remove (HOO-2680)

## 4. Verify

- [x] 4.1 Unit tests for 1.1–2.5 (HOO-2680)
- [x] 4.2 e2e `wallet-key-origin.e2e.spec.ts` on `loopback`: move, sign from `run`, no key bytes in the app origin's storage, unreachable key origin (HOO-2680)
