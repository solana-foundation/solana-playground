# Proposal

## Why

Feedback from Sergey and Natalia on 10 Nov, the day before launch:

- The wallet is hidden behind the account avatar, so people who don't sign in never see its address or balance.
- When the devnet faucet refuses, the tutorial's "Not enough devnet SOL" card says "try again in a minute". The limit rarely lifts that soon, and a newcomer doesn't know what to do on the web faucet page that the link opens.
- Airdrop from the wallet window's menu prints its outcome only to the terminal. Under Home no terminal shows, so the click seems to do nothing.

## What Changes

- **Wallet chip in the console bar.** The console bar ends with the deploying wallet's short address and balance, shown to everyone, signed in or not. It is hidden on a phone. Its popover has two blocks:
  - the wallet: name, network tag, balance, address with Copy;
  - topping it up, with one main button per state: Get SOL, Asking the faucet, the faucet refused (the web faucet in three steps, prefilled), waiting for the balance once the web faucet is open, and received.
  - Send from your wallet opens the Fund dialog.
- **Tutorial card copy.** "Not enough devnet SOL" drops "try again in a minute, or top the wallet up yourself". It lists the web faucet in three steps, and its link reads "Open the web faucet" and asks for 5 SOL, on the deploy's card and on the run's card alike.
- **Wallet menu feedback.** Airdrop from the wallet window's menu toasts its outcome: "Airdrop received.", or, at the faucet's limit, "The faucet is at its limit." with a link to the prefilled web faucet.
- **Telemetry.** `features/fund-wallet` adds `fund_airdrop_requested`, `fund_airdrop_received`, `fund_airdrop_refused` and `fund_web_faucet_opened`, and `fund_dialog_opened` gains `from: "wallet-chip"`. No funnel step's code changes: the airdrop command and the deploy are untouched, so their events keep firing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-wallet-funding`: the wallet chip and its popover, the wallet menu's airdrop toast, and the funding events they add.
- `tutorial-runs`: the "Not enough devnet SOL" card's cause line, its three faucet steps and its faucet link.

## Impact

- Code:
  - `features/fund-wallet`: `BaseWalletChip`, `WalletChip`, `FaucetRefusedToast`, telemetry, and `FundDialog`'s `from`;
  - `views/flow/console` (a `wallet` slot on the bar);
  - `components/Wallet/Settings.tsx`;
  - `widgets/tutorial-conversation` (both short-wallet cards and `FaucetSteps`);
  - `shared/lib/faucet.ts` (`webFaucetSteps`).
- The open change `deploy-rpc-pacing` still names the link "Open faucet" and has the run's link without an amount. Its delta needs the new name and `&amount=5` before it is archived.
- Out of scope:
  - a faucet run by Playground, or deploys paid for by Playground, for people with no public GitHub repo and no wallet of their own (backend work, after launch);
  - the chip on a phone;
  - showing the chip outside a project (Home has no console bar);
  - any change to the airdrop command or to its sign-in gate.
