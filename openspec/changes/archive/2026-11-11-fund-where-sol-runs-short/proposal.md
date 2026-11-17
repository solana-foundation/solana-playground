# Proposal

## Why

The Fund dialog pays the Playground wallet from a wallet the user already
has, but only the account menu and #490's wallet chip open it. The places
that say the wallet is short of SOL offer the airdrop and the web faucet and
nothing else, so someone who holds SOL in Phantom never learns they could use
it, and on mainnet or a local validator, where no faucet exists, the card
leaves them only an address to copy. Follow-up 1 of the ConnectorKit spike
(`archive/2026-10-27-connectorkit-wallet`), ticket HOO-2785.

## What Changes

- **Deploy stage.** The "Not enough SOL" card offers "Send from your wallet"
  after its first action and the web-faucet link, for every reason it shows
  (signed out, no faucet, airdrop off, airdrop refused).
- **Tutorial.** The "Not enough devnet SOL" cards of a deploy and of a run or
  call offer "Send from your wallet" after "Open the web faucet".
- **Wallet menu.** The "The faucet is at its limit." toast offers "Send from
  your wallet" under its web-faucet link.
- **One dialog.** These entries, and the account menu and the wallet chip
  (whose own dialogs move to it), open one Fund dialog mounted once beside the
  toasts, so a toast that closes does not take its dialog with it and a send
  still pending holds Send off wherever the dialog is opened from.
- **Telemetry.** `fund_dialog_opened.from` gains `deploy-card`,
  `tutorial-card` and `faucet-toast`. No event is added, renamed or removed.
  No funnel step's code changes: the deploy, the run and the airdrop are
  untouched, and their events keep firing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-wallet-funding`: where the Fund dialog is offered, and the
  `from` values those entries report.

## Impact

- Code: `features/fund-wallet` (a request to open the dialog, its host,
  `FaucetRefusedToast`), `features/deploy` (`BaseNotEnoughSol`),
  `views/flow` (`Flow`, the Deploy stage), `widgets/tutorial-conversation`
  (both short-wallet cards), `components/Wallet/Settings.tsx`.
- Stacked on `wallet-chip-faucet` (#490), whose cards and toast it extends.
- Out of scope:
  - funding states inside the Deploy button (HOO-2783, after Breakpoint);
  - signing the deploy with the external wallet (a product decision);
  - a phone, where no wallet extension exists: the dialog says so.
