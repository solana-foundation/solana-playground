# Send from your wallet where SOL runs short — Implementation Plan

> **For agentic workers:** executed inline (superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every short-wallet surface offers "Send from your wallet", opening one Fund dialog.

**Architecture:** `features/fund-wallet` gets a module-level request (`openFundDialog(from)`) and a `FundDialogHost` that listens and renders the one `FundDialog`; Flow mounts the host beside `ToastHost`. `Base*` cards take an optional `onFund` and draw the button only when given; the connected layer passes `fundFor(<from>)(address)` (review, 11 Nov: `undefined` when the dialog would fund another wallet). The account menu and the chip open the host's dialog too.

**Tech Stack:** React 19, vitest + Testing Library, the telemetry memory provider.

**Spec:** `openspec/changes/archive/2026-11-11-fund-where-sol-runs-short/specs/client-v2-wallet-funding/spec.md`, `design.md`; tasks: [tasks.md at its last commit](https://github.com/hoodieshq/solana-playground/blob/1d40f36fe7bee7e5509db3d350f1d0d02eeec349/openspec/changes/fund-where-sol-runs-short/tasks.md).

## Global Constraints

- Label, exactly: `Send from your wallet`.
- `from` values: `"deploy-card"`, `"tutorial-card"`, `"faucet-toast"` (plus existing `"account-menu"`, `"wallet-chip"`).
- Deploy card: a `CalloutAction` after "Open the web faucet" (Design alignment, 10 Nov). Tutorial cards: `Button variant="outline"` after "Open the web faucet". Toast: a text button with the faucet link's classes, under it.
- No feature imports another feature; `Base*` components do not import `features/fund-wallet`.

## Review Focus

1. The toast closes (15 s) while the dialog is open → the dialog stays open. Host owns it; test in Task 1 (host renders without the opener mounted).
2. The short wallet is not the dialog's receiver → no button (`fundFor`, review 11 Nov); tests in `model/receiver.test.ts` and each entry's tests.
3. Deploy card on a no-faucet cluster → button still there. Test in Task 2.
4. A tutorial card with the step moved on (folded, `open=false`) → nothing breaks; button lives in the body only.
5. Two `openFundDialog` calls in a row with different `from` → one `fund_dialog_opened` per opening, with the latest `from`. Test in Task 1.

---

### Task 1: The request and the host (tasks.md 1.1)

**Files:**
- Create: `client-v2/src/features/fund-wallet/model/open.ts`, `client-v2/src/features/fund-wallet/ui/FundDialogHost.tsx`, `client-v2/src/features/fund-wallet/ui/FundDialogHost.test.tsx`
- Modify: `model/telemetry.ts` (`FundFrom` type), `ui/FundDialog.tsx` (`from?: FundFrom`), `index.ts`, `client-v2/src/views/flow/Flow.tsx` (mount beside `<ToastHost />`)

**Interfaces — Produces:**
- `type FundFrom = "account-menu" | "wallet-chip" | "deploy-card" | "tutorial-card" | "faucet-toast"` (telemetry.ts)
- `openFundDialog(from: FundFrom): void`, `onDidRequestFundDialog(fn: (from: FundFrom) => void): () => void` (open.ts); `fundFor(from)(address): (() => void) | undefined` (receiver.ts)
- `FundDialogHost: () => JSX.Element` (no props)

- [ ] Test `FundDialogHost`: render host, `act(() => openFundDialog("deploy-card"))` → dialog role visible and memory provider holds `fund_dialog_opened {from:"deploy-card"}`; close, open with `"tutorial-card"` → second event with that `from`. Mock `PgWallet`/`PgConnection` as `FundDialog.test.tsx` does.
- [ ] Run `yarn test-unit src/features/fund-wallet` → FAIL.
- [ ] Implement (a `Set` of listeners in open.ts; host keeps `{open, from}` state).
- [ ] Run → PASS. Commit `feat(client-v2): one Fund dialog any short-wallet entry can open (HOO-2785)`.

### Task 2: Deploy stage card (tasks.md 1.2)

**Files:** `features/deploy/ui/BaseNotEnoughSol.tsx` (+ `.test.tsx`), `views/flow/stages/BaseDeploy.tsx` (prop `fundFor?`), `views/flow/stages/Deploy.tsx`.

- [ ] Tests: with `onFund`, every reason (`signed_out`, `no_faucet`, `airdrop_off`, `airdrop_failed`) shows button "Send from your wallet" and click calls it; on `cluster: "localnet"` it shows and no "Open the web faucet"; without `onFund` no button.
- [ ] FAIL → implement `CalloutAction onClick={p.onFund}` last in `CalloutActions` → PASS.
- [ ] Wire `fundFor={fundFor("deploy-card")}` in `Deploy.tsx`; `yarn test-unit src/views/flow/stages` PASS. Commit.

### Task 3: Tutorial cards (tasks.md 1.3)

**Files:** `widgets/tutorial-conversation/ui/BaseDeployResultCard.tsx`, `BaseTxResultCard.tsx`, `TurnView.tsx` (and whatever passes props down to `BaseTxResultCard`), `deploy-cards.test.tsx`, `turns.test.tsx`.

- [ ] Tests: deploy `no_funds` card and tx `no_funds` card with `onFund` show "Send from your wallet" after "Open the web faucet" and call it; without it, no button.
- [ ] FAIL → implement (outline `Button`, `max-sm` stacking as the existing row) → PASS.
- [ ] Wire `fundFor: fundFor("tutorial-card")` in the tutorial's handlers. Commit.

### Task 4: Faucet-refused toast (tasks.md 1.4)

**Files:** `features/fund-wallet/ui/FaucetRefusedToast.tsx` (+ new `.test.tsx`).

- [ ] Tests: for the receiver's address, the toast shows "Send from your wallet"; clicking it emits `fund_dialog_opened {from:"faucet-toast"}`; for another address, no button.
- [ ] FAIL → implement → PASS. Commit.

### Close

- [ ] `yarn run check` in `client-v2/`; tick 1.1–1.4 in tasks.md (linked above).
