# Design

## Context

See proposal.md for why. What exists today:

- `providers/solana/SolanaProvider.tsx` mounts `@solana/wallet-adapter-react`'s
  `WalletProvider` with no adapters, so only Wallet Standard wallets are found.
  An effect copies the installed ones into `PgWallet.standardWallets`, typed as
  wallet-adapter's `StandardWalletAdapter`.
- `PgWallet` (`utils/wallet`) has four states: `setup`, `disconnected`, `pg`
  (a Playground account is current) and `sol` (the extension named by
  `standardName` is current). `PgWallet.current` is what every transaction
  path signs with by default (`PgTx.send`).
- What reads an external wallet: `connect <wallet>` (`commands/connect`), the
  legacy wallet window (`components/Wallet/Settings.tsx`), `pg.wallets` in the
  JS runtime, the editor's wallet type declarations, the footer's account
  view (`widgets/session-footer/ui/use-account.tsx`), and `deploy`.
- The members actually used are `name`, `icon`, `readyState`, `connected`,
  `connecting`, `publicKey`, `connect`, `disconnect`, `signTransaction`,
  `signAllTransactions`, `signMessage`, and `on`/`off` for `connect` (the
  bridge adds `disconnect`).
- Constraints: TypeScript 5.0.4 with `moduleResolution: node`, so a package's
  `exports` subpaths do not resolve; `@solana/connector`'s root entry exports
  everything needed (checked with a type-checked probe). `localStorage` is
  near its origin budget (root CLAUDE.md).

## Goals / Non-Goals

**Goals:**

- One wallet-discovery path, ConnectorKit, behind the shape `PgWallet`
  already reads, so nothing that reads external wallets changes.
- A funding action a user can finish in one dialog with one wallet approval.
- A written answer to the spike (HOO-1617), below, with follow-ups.

**Non-Goals:**

- Using ConnectorKit's React hooks or UI elements: the app draws with the
  design system, and its own hooks would need ConnectorKit's provider and a
  second store beside `PgWallet`.
- ConnectorKit's cluster selection, balance and token queries, CoinGecko
  prices, WalletConnect, Mobile Wallet Adapter.

## Decisions

**1. ConnectorKit as the registry and the signer; each wallet connects on
its own.** `entities/external-wallet` takes from ConnectorKit what it does
well: its Wallet Standard registry (`getWalletsRegistry`, `ready`), which
sees wallets that registered before and after the app loaded, and its signer
(`createTransactionSigner`). It creates no `ConnectorClient`: a client holds
one session, while `PgWallet` lets several extensions be connected at once
(`pg.wallets`, `getConnectedStandardWallets`), and the Fund dialog must
connect a payer without dropping an extension that is the current wallet. So
the bridge keeps the wallets wallet-adapter kept (a `solana:` chain,
`standard:connect`, `standard:events` and `solana:signTransaction`, so every
listed wallet can report changes and sign what `PgTx` builds), connects each through its own
`standard:connect`/`standard:disconnect`, as wallet-adapter's
`StandardWalletAdapter` did, and keeps per-wallet state (`connected`,
`connecting`, the selected account). It publishes the list to
`PgWallet.standardWallets` on every registration; the React provider shrinks
to mounting that subscription.
Alternatives: ConnectorKit's `AppProvider` + hooks, rejected because it puts
wallet state in React while the terminal commands and the JS runtime read it
through `PgWallet`; a `ConnectorClient` session, rejected because connecting
a payer would disconnect the current extension and `PgWallet` would then
re-run an interactive `connect()` on it (checked with a probe on 2026-10-27:
the client's connector list also stays empty until its own async start, where
the registry answers at once). Reconnecting after a reload stays `PgWallet`'s
(`sol` + `standardName`, calling `connect()`, which a wallet that trusts the
site answers without a prompt), so ConnectorKit writes no storage.
The signing cluster is passed in by the caller (`watchExternalWallets(...,
{ signingCluster })`), so the entity does not import the Playground's
connection.

**2. Our own `StandardWallet` type.** `utils/wallet/types.ts` declares the
members the app uses instead of extending wallet-adapter's
`StandardWalletAdapter`, so both wallet-adapter packages can go. The type is
structural, so the call sites do not change.

**3. Signing through `createTransactionSigner`.** The bridge's
`signTransaction`/`signAllTransactions` call ConnectorKit's legacy-compatible
signer for the wallet and its selected account, which accepts
`@solana/web3.js` transactions, the type `PgTx` builds. The signer's `cluster`
is the Playground's (`PgConnection.cluster`: `mainnet-beta`, `devnet`,
`testnet` map to ConnectorKit's clusters; `localnet` and `playnet` pass none,
so the wallet signs without a chain hint, as wallet-adapter did). The signer
rethrows every failure as "Failed to sign transaction"; the bridge rethrows
the wallet's own error from it, so a rejection still reads as one. `signMessage` uses the wallet's
`solana:signMessage` feature when it has one, else is absent, as before.

**4. Account changes are a `connect` event.** The old provider re-derived
`PgWallet.current` on wallet-adapter's `connect` event, which fires after an
account switch. The bridge listens to the wallet's own `standard:events`
`change` event, takes the new first Solana account, and emits `connect` the
same way, so `SolanaProvider`'s handler keeps working; when no Solana
account is left (the user revoked the site) it emits `disconnect`, which the
provider now handles too, and an unchanged address emits nothing. `readyState` is always
`"Installed"` (a registered wallet is installed), and `name` is the Wallet
Standard name, the same string wallet-adapter used, so a stored
`standardName` still finds its wallet.

**5. Funding is its own feature, `features/fund-wallet`.** It reads
the wallet list from `PgWallet.standardWallets` (bridged by
`entities/external-wallet`), connects the payer through its own `connect()`
without touching `PgWallet.state`, and sends with
`PgTx.send(transferIx, { wallet: payer })` so blockhash, fee payer, priority
fee and RPC are the Playground's own. The receiver is `PgWallet.current` when
it is a Playground wallet, else `PgWallet.accounts[0]`, the account `deploy`
pays from. `BaseFundDialog` draws from props; `FundDialog` connects it. The
account menu (widget `session-footer`) opens it.

**6. The dialog is built from design-system parts.** There is no funding
design in the prototype, Almaz's stand or the design system (checked
2026-10-27). The dialog uses `Dialog`, `Button`, `AsyncButton`, `Field`,
`Input` and `Callout` from `shared/ui`; the layout goes to "Tool - Design
alignment" as a question, and a designed version replaces it without changing
the spec's ids and labels.

## Deploy path and the external wallet (spike, HOO-1617)

**How deploy and upgrade sign today.** `deploy` runs `checkWallet`, which only
asks that some wallet is current. In `processDeploy`:

1. The payer for the buffer is a Playground account: the current wallet when
   it is one, else `PgWallet.accounts[0]`.
2. With an extension current (`sol`), it first transfers the deploy's cost
   plus 0.1 SOL from the extension to that account (one approval), so the
   buffer writes need no approvals.
3. The buffer is created and written by the Playground account.
4. With an extension current, the buffer authority is moved to the extension.
5. `deployProgram`/`upgradeProgram` are sent with the default wallet,
   `PgWallet.current`: the extension signs the last transaction (a second
   approval) and becomes the upgrade authority. An upgrade later checks
   `PgProgramInfo.onChain.authority` against `PgWallet.current`.
6. When the balance is short, the terminal offers a devnet airdrop
   (`airdropTopUp`); mainnet has no remedy but to fund the wallet by hand.

Scripts and tests get `pg.wallet` (the current wallet; Anchor's provider adds
`payer` only for a Playground wallet) and `pg.wallets` (every Playground
account and every connected extension). Tutorials use `pg.wallet.publicKey`
and `pg.wallet.keypair`; `keypair` exists only on a Playground wallet.

**Directions considered.**

- **A. Keep the Playground wallet as the deploy signer; the external wallet
  only funds it.** What this change builds. One approval per funding, none
  per deploy; tutorials and `pg.wallet.keypair` keep working; the upgrade
  authority is a key held in `localStorage`, which HOO-1717 covers.
- **B. The external wallet as a signer of the deploy.** What the `sol` path
  already does for the final transaction. Writing the buffer with it would
  ask for an approval per chunk (hundreds for a large program), so only the
  authority steps can use it. It gives the user a real upgrade authority, but
  `pg.wallet.keypair` is missing, so tutorials that sign with it break while
  an extension is current.
- **C. The Playground wallet as a Wallet Standard wallet.** Register the
  Playground account with ConnectorKit so every path sees one kind of wallet.
  It unifies the code but changes nothing for the user, and it would expose
  the in-browser key to any page script that lists wallets.

**Recommendation: A now, B only as an explicit choice later.** Keep the
Playground wallet the deploy signer and treat the external wallet as a
funding source. Keep the existing `sol` path untouched in this change, since
changing it changes deploy behaviour. C is not worth its risk.

**Risks the spike found.**

- External signing on a cluster the wallet does not show: Phantom simulates
  against its own selected network and may warn on a devnet transfer. The
  transfer is still valid; the dialog says which cluster it sends on.
- Local keypair signing: the deploy authority is a key in `localStorage`
  (HOO-1717). Funding moves real SOL to it on mainnet; the mainnet disclaimer
  (HOO-867) should name funding too.
- Airdrops: unchanged; funding is the remedy where airdrops fail or do not
  exist.
- Tutorials: unchanged under A; under B any tutorial using
  `pg.wallet.keypair` breaks while an extension is current.

**Follow-ups to file** (asked of Slava before filing):

1. Offer "Fund from a wallet" in `deploy`'s short-balance prompt, beside or
   instead of the airdrop, and on mainnet where no airdrop exists.
2. Decide the `sol` deploy path: keep the extension as upgrade authority, ask
   each time, or always use the Playground wallet (a deploy behaviour change,
   so a product decision).
3. Name funding in the mainnet disclaimer (HOO-867).

## Risks / Trade-offs

- [Bundle grows with `@solana/kit` 8] → only the registry and signer are
  imported; size before and after is measured (task 1.4) and put in the PR.
- [Two callers connect the same wallet at once (`PgWallet`'s `sol` derive on
  load and a click)] → the bridge's `connect()` returns the connect already
  in flight for that wallet instead of starting a second prompt.
- [Only a fake wallet is tested automatically] → the PR carries a manual
  check with a real Phantom on devnet: connect from the terminal, switch
  account, fund, reload.
- [`connect <wallet>` toggles: a wallet connected in the Fund dialog is
  disconnected by `connect <wallet>`] → accepted; it matches the command's
  existing toggle, and the dialog shows the state either way.
- [ConnectorKit is 0.x] → pinned exactly (`0.3.0`); the bridge is the only
  module that imports it.
- [ConnectorKit imports WalletConnect lazily, an optional peer we do not
  install] → webpack resolves `@walletconnect/universal-provider` to an empty
  module (`craco.config.js`); the import runs only when WalletConnect is
  configured, which the app never does.

## Migration Plan

No stored state changes: `PgWallet`'s `wallet` key keeps its shape, and the
`sol` state with `standardName` still names the extension by its name.
ConnectorKit holds no session and adds no `localStorage` keys. Rollback is reverting the PR.
