# Wallets through ConnectorKit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Wallet Standard discovery and connection run on ConnectorKit's
headless client, handed to `PgWallet` in the shape it already reads; nothing
that reads external wallets changes.

**Architecture:** `entities/external-wallet` bridges ConnectorKit's Wallet
Standard registry to the app's `StandardWallet`; no `ConnectorClient` (design.md, Decision 1).
`SolanaProvider` subscribes the bridge to `PgWallet.standardWallets`.

**Tech Stack:** `@solana/connector` 0.3.0 (root entry only: TS 5.0.4,
`moduleResolution: node`), `@solana/web3.js` 1.98, vitest in-source blocks,
Playwright.

**Spec:** `../specs/client-v2-external-wallet/spec.md`, `../design.md`
(Decisions 1–4).

## As built (2026-10-27)

Where the code differs from the tasks below, the code and design.md win:

- No `ConnectorClient` and no `model/client.ts`: the bridge reads ConnectorKit's registry (`getWalletsRegistry`, `ready`).
- The app's type kept the name `StandardWalletAdapter` (not `…Like`); `BridgedWallet` implements it.
- The fake wallet lives in `src/test-utils/fake-wallet.ts` and registers itself by dispatching `wallet-standard:register-wallet`; the e2e copy is `e2e/fake-wallet.ts`.
- One bridged object per wallet object (a `WeakMap`), not per connector id.
- Signing tests sit in `model/bridge.signing.test.ts` (node environment); the slice exports `watchExternalWallets` and two types.
- Listed wallets need `standard:events` and `solana:signTransaction` too (review C1); signer errors are unwrapped to the wallet's own.
- Review Focus 2 is covered only as "two `connect()` calls share one request"; there is no separate restore in the bridge.

## Global Constraints

- Pin `@solana/connector` at exactly `0.3.0`; import only from `"@solana/connector"`.
- No `@solana/wallet-adapter-*` import remains in `client-v2/`.
- No `ConnectorClient`; ConnectorKit adds no storage. `@walletconnect/universal-provider` resolves to an empty module in `craco.config.js`.
- A `catch` is never empty; logs go through `createLogger("external-wallet:<module>")`.
- Ids from `shared/lib/ids`; no nested ternaries; tests follow `AGENTS.md` (in-source unless the rule lists an exception; no spread to build fixtures).

## Review Focus

1. A wallet that registers after load (extensions inject late) → offered without reload. Test in Task 2.
2. A reload with a remembered wallet while `PgWallet.state === "sol"` → one silent restore, not an interactive `connect()` racing it. Test in Task 2 (`connect()` during restore shares the restore).
3. The user declines the connection → `connect()` rejects with the wallet's error, `connecting` returns to false. Test in Task 2.
4. Account switched inside the extension → `connect` event fires, `publicKey` changes. Test in Task 2.
5. A wallet with no `solana:*` chain (an EVM-only wallet) → not offered. Test in Task 2.

---

### Task 1: Dependency swap and the app's own wallet type (tasks.md 1.1)

**Files:** Modify `client-v2/package.json`, `client-v2/yarn.lock`, `client-v2/src/utils/wallet/types.ts`.

**Interfaces — Produces:** in `utils/wallet/types.ts`

```ts
export interface StandardWalletEvents { connect(): void; disconnect(): void }
export interface StandardWalletAdapterLike {
  readonly name: string;
  readonly icon: string;
  readonly readyState: "Installed";
  readonly connected: boolean;
  readonly connecting: boolean;
  readonly publicKey: PgWeb3.PublicKey | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  signTransaction?<T extends AnyTransaction>(tx: T): Promise<T>;
  signAllTransactions?<T extends AnyTransaction>(txs: T[]): Promise<T[]>;
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
  on<E extends keyof StandardWalletEvents>(event: E, fn: StandardWalletEvents[E]): void;
  off<E extends keyof StandardWalletEvents>(event: E, fn: StandardWalletEvents[E]): void;
}
```

`StandardWallet<C>` keeps its name and generic and is built from this instead of wallet-adapter's.

- [ ] Step 1: `yarn remove @solana/wallet-adapter-react @solana/wallet-adapter-base` (connector already added, exact).
- [ ] Step 2: Replace the wallet-adapter imports in `types.ts` with the interface above.
- [ ] Step 3: `yarn test-types` — expected: only the six pre-existing `getRecentPrioritizationFees` errors (local env, present on the base branch), and errors in `SolanaProvider.tsx`, fixed in Task 3.

### Task 2: `entities/external-wallet` — client and bridge (tasks.md 1.2)

**Files:** Create `client-v2/src/entities/external-wallet/index.ts`, `model/bridge.ts`, `model/bridge.signing.test.ts` (node environment: web3.js byte checks fail under jsdom), `client-v2/src/test-utils/fake-wallet.ts`.

**Interfaces — Produces:**

- `watchExternalWallets(onChange: (wallets: StandardWallet[]) => void, opts: { signingCluster: () => SigningCluster | undefined }): () => void` — calls back with the bridged list now, when the registry is ready, and on every (un)registration; returns unsubscribe.
- `registerFakeWallet(opts: { name: string; chains?: string[]; accounts: PgWeb3.Keypair[]; reject?: "connect" | "sign" }): { wallet; switchAccount(i: number): void; unregister(): void }` — a Wallet Standard wallet registered through `@wallet-standard/app`'s `registerWallet`, implementing `standard:connect`, `standard:disconnect`, `standard:events`, `solana:signTransaction`, `solana:signMessage`. Shared by unit tests and (in page form) the e2e spec.

**Bridge rules (design.md Decisions 1, 3, 4):** registry only, no client. One bridged object per connector id, reused across snapshots (so `on`/`off` listeners survive). Per-wallet state lives in the bridged object: `connect()` calls the wallet's `standard:connect` feature (returns the in-flight promise if one is pending), takes the first account whose `chains` include a `solana:` chain, sets `publicKey`, emits `connect`; `disconnect()` calls `standard:disconnect` when present, clears state, emits `disconnect`; `standard:events` `change` with `accounts` → new first Solana account, emit `connect` (or `disconnect` when none remain). `signTransaction`/`signAllTransactions` exist only when the wallet has `solana:signTransaction`, and go through `createTransactionSigner({ wallet, account, cluster })`, `cluster` from `PgConnection.cluster` (`mainnet-beta`/`devnet`/`testnet` → ConnectorKit's cluster; `localnet`/`playnet` → omitted). `readyState` is always `"Installed"`.

Add to Step 1's tests: `connecting a second wallet leaves the first connected`.

- [ ] Step 1: In-source block in `bridge.ts`, `describe("entities/external-wallet/model/bridge")`, tests (each registers a fake wallet in `beforeEach`, unregisters and resets client storage in `afterEach`):
  - `lists a Solana wallet with its name and icon`
  - `lists a wallet registered after the first snapshot`
  - `does not list a wallet without a solana chain`
  - `connects, then reports connected with the first account's public key`
  - `rejects connect when the wallet declines, and is no longer connecting`
  - `fires connect and changes publicKey when the account switches`
  - `shares one connect while a connect is in flight` (two calls → wallet's `standard:connect` called once)
  - `signs a web3.js Transaction with the selected account` (signature verifies with `nacl`/`ed25519`)
  - `disconnects and fires disconnect`
- [ ] Step 2: `yarn test-unit src/entities/external-wallet/model/bridge.ts` — expected FAIL (module missing).
- [ ] Step 3: Implement `client.ts`, `bridge.ts`, `fake-wallet.ts`, `index.ts` (exports the three functions and the type re-export; `registerFakeWallet` is exported from `model/fake-wallet.ts` only, not the slice API).
- [ ] Step 4: Same command — expected PASS. `yarn lint` clean for the slice.
- [ ] Step 5: Commit `feat(client-v2): find and connect wallets through ConnectorKit`.

### Task 3: `SolanaProvider` on the bridge; e2e (tasks.md 1.3)

**Files:** Modify `client-v2/src/providers/solana/SolanaProvider.tsx`. Create `client-v2/e2e/external-wallet.e2e.spec.ts` and `client-v2/e2e/helpers/fake-wallet.ts` (page-side registration via `page.addInitScript`; no `import.meta`).

- [ ] Step 1: e2e spec titles (from the spec): `client-v2-external-wallet: An installed wallet is offered` (fake "Phantom" registered → `connect ` + Tab completes `phantom`, or the wallet window menu shows `Connect to Phantom`), `client-v2-external-wallet: Connect from the terminal` (`connect phantom` → terminal prints `Connected to Phantom.`), `client-v2-external-wallet: Reload after connecting` (reload → footer wallet line shows the fake account's short address with no `standard:connect` call recorded after reload beyond the silent one).
- [ ] Step 2: Run `yarn test-e2e e2e/external-wallet.e2e.spec.ts` — expected FAIL.
- [ ] Step 3: `SolanaProvider` drops `WalletProvider`; `PgWalletProvider` keeps the account-change effect and replaces the `useSolanaWallet` effect with `useEffect(() => watchExternalWallets((w) => { PgWallet.standardWallets = w; }), [])`.
- [ ] Step 4: Same e2e — PASS; `yarn test-unit src/components/Wallet` and `src/commands/connect` — PASS unchanged.
- [ ] Step 5: Commit.

### Task 4: Bundle size (tasks.md 1.4)

- [ ] Step 1: `yarn build:bundle` on the base and on the branch (or `build-fast` if that is what CI's size check uses); record `build/static/js` total gzip with `gzip -c | wc -c` for both, into the PR description.
