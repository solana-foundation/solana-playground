# Tasks

## 1. Wallet chip and faucet copy

- [x] 1.1 Add `BaseWalletChip` and `WalletChip` to `features/fund-wallet`, the `wallet` slot on `BaseConsoleDrawer`,
  and the four `fund_airdrop_*` / `fund_web_faucet_opened` events with `fund_dialog_opened`'s `from`; verify with
  `yarn test-unit src/features/fund-wallet src/views/flow/console` (ticket to file)
- [x] 1.2 Rewrite the tutorial's "Not enough devnet SOL" cards around `webFaucetSteps` and "Open the web faucet";
  verify with `yarn test-unit src/widgets/tutorial-conversation` (ticket to file)
- [x] 1.3 Toast the wallet menu's airdrop outcome with `FaucetRefusedToast`; verify by hand on devnet, signed in
  (ticket to file)
- [x] 1.5 Give the Deploy stage's "Not enough SOL" card the web faucet steps and the prefilled link with the amount,
  and the automatic airdrop's note the amount; verify with `yarn test-unit src/features/deploy
  src/effects/automatic-airdrop` (ticket to file)
- [ ] 1.4 Assert the chip's events through the memory provider in a `WalletChip` test (ticket to file; depends on 1.1)
