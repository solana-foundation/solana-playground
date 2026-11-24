# Tasks

## 1. Accounts from the chip and the deploy hold

- [x] 1.1 Give the chip popover "Accounts" beside "Connect a wallet", hidden for an extension and mid-deploy,
  opening the Wallet window; verify with `yarn test-unit src/features/fund-wallet` (HOO-2972)
- [x] 1.2 Name the paying account in the chip header and the Deploy payer line through `payingAccountName`,
  with `DeployPayer` as a union; verify with `yarn test-unit src/entities/wallet src/views/flow/stages` (HOO-2972)
- [x] 1.3 Show balances to up to 4 decimals in the account menu and the payer line; verify with
  `yarn test-unit src/widgets/session-footer` (HOO-2972)
- [x] 1.4 Hold the accounts for a deploy's run (`PgWallet.holdSwitch`, `AccountsHeldError`), disable the Wallet
  window's items while held, and show refusals as plain messages; verify with
  `yarn test-unit src/utils/wallet src/commands/deploy src/components/Wallet src/widgets/overlays` (HOO-2972)

## 2. Design answers (Slava's questions in the SF#205 body)

- [ ] 2.1 Confirm where the account list lives (the Wallet window, not the chip popover) and whether two wallet
  surfaces stay (questions 1, 2)
- [ ] 2.2 Confirm the label "Accounts", its half-width placement beside "Connect a wallet", and hiding it for an
  extension (questions 3, 4, 5); update the chip requirement if any changes
- [ ] 2.3 Decide the payer line on narrow widths and the 4-decimal balance (questions 6, 7); update the Deploy
  requirement if either changes
