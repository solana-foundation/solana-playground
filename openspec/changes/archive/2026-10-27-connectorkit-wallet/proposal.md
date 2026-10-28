# Proposal

## Why

A user who brings SOL in their own wallet (Phantom, Solflare, Backpack) has no
designed way to move it into the Playground wallet, which is the one that
deploys. Devnet airdrops are rate-limited and mainnet has none, and Kora,
which will pay devnet fees later, does not exist yet. The scope sheet's row
"ConnectorKit integration and funding flow" (G Deploys, P1) asks for this
before Kora: connect an external wallet through ConnectorKit and fund the
Playground wallet from it, while the Playground wallet stays the deploy
signer. Today wallets are found through `@solana/wallet-adapter-react` with an
empty adapter list, a path that trails the published packages and that the
Solana Foundation is replacing with ConnectorKit (`@solana/connector`).

## What Changes

- Wallet Standard discovery moves from `@solana/wallet-adapter-react` to
  ConnectorKit's wallet registry, and signing to its transaction signer. The
  wallets it finds are handed to `PgWallet` in the shape it already reads, so
  the `connect <wallet>` command, the wallet window's list, `pg.wallets` in
  scripts and the editor's wallet types keep working unchanged.
- `@solana/wallet-adapter-react` and `@solana/wallet-adapter-base` are removed;
  `@solana/connector` 0.3.0 is added.
- New: **Fund the Playground wallet**. The account menu gets "Fund from a
  wallet", which opens a dialog: pick a detected wallet, connect it, enter an
  amount in SOL, approve one transfer in the wallet. The SOL lands in the
  Playground wallet that deploys; the current wallet does not change.
- Deploy, upgrade and every signing path stay exactly as they are. The spike
  (design.md, "Deploy path and the external wallet") records how they depend
  on `PgWallet` and recommends what comes next.
- Telemetry: a new slice `features/fund-wallet` (prefix `fund`) adds
  `fund_dialog_opened`, `fund_wallet_connected`, `fund_sent` and
  `fund_failed`. `session_account_item_picked` (widget `session-footer`) gains
  the item value `fund-wallet`. No event is renamed or removed.

## Capabilities

### New Capabilities

- `client-v2-external-wallet`: how client-v2 finds and connects Wallet
  Standard wallets, and what a connected external wallet may and may not
  change (it never becomes the deploy signer through this change).
- `client-v2-wallet-funding`: moving SOL from a connected external wallet into
  the Playground wallet, its dialog, its errors and its telemetry.

### Modified Capabilities

None. No spec under `openspec/specs/` covers wallets today.

## Impact

- Code: `client-v2/src/providers/solana/SolanaProvider.tsx`,
  `client-v2/src/utils/wallet/types.ts`, a new `entities/external-wallet`
  slice, a new `features/fund-wallet` slice, `widgets/session-footer` (one
  menu item).
- Dependencies: `@solana/connector` 0.3.0 and its `@solana/kit` 8 tree
  (about 45 KB gzip by the package's own badge; measured in task 1). The two
  wallet-adapter packages go.
- Storage: none added. ConnectorKit runs without its own session or
  persistence; reconnecting after a reload stays `PgWallet`'s, as today.
- Out of scope: changing who signs deploys or upgrades; the legacy path where
  a deploy with an extension as the current wallet funds the Playground wallet
  and hands the upgrade authority to the extension (`commands/deploy`) stays
  as it is; WalletConnect and Mobile Wallet Adapter; moving the Playground
  wallet's secret key out of `localStorage` (HOO-1717); Kora (HOO-1777,
  HOO-1778); a designed funding screen (the prototype has none, so the dialog
  is built from design-system parts and goes to design review).
