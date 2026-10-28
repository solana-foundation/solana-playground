# Fund the Playground wallet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** "Fund from a wallet" in the account menu opens a dialog that moves
SOL from a connected external wallet to the Playground account `deploy` pays
from, with one wallet approval; the current wallet never changes.

**Architecture:** `features/fund-wallet` (model + telemetry + `BaseFundDialog`
/ `FundDialog`); the widget `session-footer` mounts the entry point and the
dialog separately, so moving the entry (Deploy, Setup list, wallet window)
only changes where `FundDialog` is mounted. Wallets come from
`PgWallet.standardWallets` (bridged by `entities/external-wallet`, PR 1).

**Tech Stack:** React 19, design-system parts from `shared/ui` (`Dialog`,
`Button`, `AsyncButton`, `Field`, `Input`, `Callout`), `PgTx`, web3.js.

**Spec:** `../specs/client-v2-wallet-funding/spec.md`, `../design.md`
(Decisions 5, 6). Stacked on PR 1 (sections 1 and 2).

## Global Constraints

- Copy is the spec's, verbatim: "Fund from a wallet", "Fund the Playground wallet", `Connect <name>`, "No wallet found", "Amount (SOL)" (id `fund-amount`), `Send <amount> SOL`, `Sent <amount> SOL to <receiver name>.`, "Couldn't send the SOL.".
- Amount starts at `1`; positive, at most 9 decimals; must not exceed payer balance − 0.001 SOL.
- No event carries an address or an amount. Prefix `fund`.
- `AsyncButton` passes `onError={reportButtonFailure("<what>")}`; a `catch` is never empty.
- Open design question (Design alignment, 2026-10-27): where funding lives. Keep entry and dialog separate.

## Review Focus

1. Payer balance unknown (RPC slow/failed) → send stays enabled? No: the balance check needs a number; while loading, the button is disabled and the field says "Checking the balance…". Test in Task 1 (`canSend` with `balance: null`).
2. Amount with a comma (`0,5`) or spaces → treated as invalid, not as 0 or 5. Test in Task 1.
3. Dialog closed mid-signature → no toast or state update after unmount; the transfer outcome is still logged. Test in Task 3.
4. Payer is the receiver (an extension that is also… cannot be: receiver is always a Playground account, payer always an extension) — no test needed; noted.
5. Cluster switched while the dialog is open → the transfer goes to the cluster current at send time (`PgTx` reads it then). Test in Task 1 by asserting `fund` reads `PgConnection` only inside the call.

---

### Task 1: model (tasks.md 3.1)

**Files:** Create `client-v2/src/features/fund-wallet/model/fund.ts` (in-source tests), `model/telemetry.ts` (Task 2).

**Produces:**

- `receiverOf(wallet: { current: Wallet | null; accounts: WalletAccount[] }): { name: string; publicKey: PublicKey } | null` — current if `isPg`, else `accounts[0]` (via `PgWallet.create`), else `null`.
- `parseAmount(text: string): { ok: true; sol: number; lamports: number } | { ok: false; reason: "not-a-number" | "not-positive" | "too-precise" }`.
- `canSend(amount, balance: number | null): { ok: true } | { ok: false; reason: "checking" | "above-balance" | <parse reasons> }` with `FEE_RESERVE_SOL = 0.001`.
- `fund(params: { payer: StandardWallet<true>; to: PublicKey; lamports: number }): Promise<string>` — `PgTx.send(SystemProgram.transfer(...), { wallet: payer })`, then `PgTx.confirm`; throws `FundError` with `stage: "send"`, `reason`.
- `classify(error: unknown): "rejected" | "network" | "unknown"` — rejected when the message matches a wallet rejection (`/reject|denied|cancel/i`), network when it is a `SendTransactionError`, a confirm `err`, or a fetch failure.

- [ ] Tests first (names): `receiverOf picks the current Playground wallet`, `… the first account when an extension is current`, `… null before setup`; `parseAmount accepts 1 and 0.000000001`, `… rejects abc, 0, -1, 0,5 and 1e-10`; `canSend is checking while the balance is unknown`, `… above the balance less the fee reserve`; `classify reads a wallet rejection as rejected`, `… a SendTransactionError as network`. `fund` is covered by the React test of Task 3 and the e2e of Task 4 (it calls `PgTx`, which needs the app's globals).
- [ ] `yarn test-unit src/features/fund-wallet/model/fund.ts` FAIL → implement → PASS. Commit.

### Task 2: telemetry (tasks.md 3.2)

**Files:** `model/telemetry.ts`, `src/shared/lib/telemetry/prefixes.ts` (`"fund-wallet": "fund"`), `index.ts`.

Events exactly as the spec. Tests through the memory provider in Task 3's React test (`fund_dialog_opened`, `fund_wallet_connected`, `fund_sent`, `fund_failed`); `src/app/slice-structure.test.ts` passes. Commit.

### Task 3: dialog (tasks.md 3.3)

**Files:** `ui/BaseFundDialog.tsx`, `ui/FundDialog.tsx`, `ui/BaseFundDialog.test.tsx`, `ui/FundDialog.test.tsx`.

`BaseFundDialog` props: `open`, `onOpenChange`, `receiver`, `wallets: { name; icon; connected; address: string | null; balance: number | null }[]`, `payer: string | null` (wallet name), `amount`, `onAmountChange`, `onConnect(name)`, `onSend(): Promise<void>`, `error: { kind: "connect-declined" | "send-declined" | "send-failed"; detail?: string } | null`. `FundDialog` reads `PgWallet`, subscribes to the payer's `connect`/`disconnect`, fetches the payer balance with `PgConnection.current.getBalance`, emits telemetry, toasts on success through the existing toast path.

- [ ] React tests per spec scenario: receiver line (both cases), `Connect Phantom` → address + balance, "No wallet found", declined connect, amount above balance, not a number, successful send (toast text, dialog closes, `fund_sent`), declined send (`fund_failed` `{stage:"send",reason:"rejected"}`, amount kept), network failure ("Couldn't send the SOL." + retry). Commit.

### Task 4: entry point (tasks.md 3.4)

**Files:** `widgets/session-footer/model/account.ts` (`AccountItem` + `"fund-wallet"`, `AccountView.canFund`), `ui/BaseAccountMenu.tsx` (item in the wallet group, icon `HandCoins`), `ui/use-account.tsx` (opens the dialog), `ui/SessionFooter.tsx`/`RailFooter.tsx` (mount `FundDialog` once), `BaseAccountMenu.test.tsx`; `e2e/wallet-funding.e2e.spec.ts`: `client-v2-wallet-funding: Successful funding` (fake wallet with `sign`, `page.route` stubs for the RPC methods `getLatestBlockhash`, `getBalance`, `sendTransaction`, `getSignatureStatuses`/`confirmTransaction`), `client-v2-wallet-funding: Playground wallet set up`, `client-v2-wallet-funding: No Playground wallet yet`, `client-v2-external-wallet: A payer beside the current extension`. Commit.
