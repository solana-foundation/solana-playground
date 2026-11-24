# Proposal

## Why

Sergey found two wallet UIs (23 Nov). The account menu opens the floating Wallet window, which can switch
Playground accounts. The console-bar wallet chip, where the wallet has lived since 10 Nov, cannot. Two windows
for one wallet read as two wallets. Almaz's hoodieshq#524 gives the chip a way to the accounts; this change
brings it into foundation master (HOO-2972, SF#205).

The review of #524 found that the Wallet window could switch, add, import or remove accounts while a deploy
ran. The deploy signs with the account it started with, so the chip and the payer line then named one account
while another paid.

## What Changes

- **Accounts in the chip popover.** Beside "Connect a wallet" the chip popover offers "Accounts". It closes the
  popover and opens the Wallet window, where Playground accounts are added and switched. It does not show
  while an extension is the current wallet, or while a deploy runs.
- **The paying account is named.** With two or more Playground accounts, the chip's header and the Deploy
  stage's payer line name the account that pays: "Playground wallet · Wallet 2". One rule
  (`payingAccountName`, `entities/wallet`) serves both.
- **Balances to up to 4 decimals.** The account menu and the Deploy payer line show the balance to up to four
  decimals, like the chip; an empty wallet reads "0 SOL".
- **A deploy holds the paying account.** From the start of a deploy to its end (success, failure, stop, pause
  or cancel), the Playground wallet refuses to switch, pick an extension, add, create, import or remove an
  account. The Wallet window disables those actions meanwhile, and a refusal reads as a plain message, not a
  reported failure. Terminal and stage deploys alike. An extension whose approval arrives during the deploy
  stays connected but does not become current.
- **Events.** No event is added, renamed or removed. Accounts opens the Wallet window with no event of its
  own, and a held-accounts refusal is neither tracked nor reported (`overlay_modal_submit_failed` does not
  fire for it).

The design wording is open: Slava's seven questions in the SF#205 body (where the account list lives, whether
two wallet surfaces stay, the label "Accounts", its half-width placement, hiding it for an extension, the payer
line on narrow widths, the 4-decimal balance). The requirements here state what the PR builds; tasks 2.x
track the answers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-wallet-funding`: the chip popover's Accounts button and the paying account's name in its header.
- `client-v2-wallet`: a running deploy holds the Playground wallet's accounts.
- `client-v2-deploy`: the payer line names the paying account and shows the balance to up to 4 decimals.

## Impact

- Code: `features/fund-wallet` (`BaseWalletChip`, `WalletChip`), `entities/wallet` (`payingAccountName`),
  `utils/wallet` (`PgWallet.holdSwitch`, `onDidChangeSwitchHeld`, `AccountsHeldError`), `commands/deploy`
  (`deploy.ts` holds the accounts for the run), `components/Wallet` (`Wallet.tsx`, `Settings.tsx`),
  `views/flow/stages` (`BaseDeploy`, `Deploy`), `widgets/overlays` (`ModalFrame` shows plain refusals),
  `widgets/session-footer` (`formatBalance`), `shared/ui/popover` (`PopoverClose`).
- No server, storage or outside contract changes.
