# Tasks

Two PRs, stacked: section 1 (with the spike, task 2.1) lands first; section 3
follows it. Tick a task in the PR that lands it.

## 1. Wallets through ConnectorKit

Plan: [plans/1-wallets-through-connectorkit.md](plans/1-wallets-through-connectorkit.md)

- [x] 1.1 Add `@solana/connector` 0.3.0 (exact), remove
      `@solana/wallet-adapter-react` and `@solana/wallet-adapter-base`, and
      declare the app's own `StandardWallet` type in `utils/wallet/types.ts`;
      verify `yarn test-types` reports no error the base branch lacks
      (HOO-1616)
- [x] 1.2 `entities/external-wallet`: the bridge from ConnectorKit's wallet
      registry to `StandardWallet` (connect, disconnect, sign, `connect` on
      account change, one connect in flight shared by `connect()`); verify
      with in-source tests and `bridge.signing.test.ts` (node) over a fake
      Wallet Standard wallet: listing, late registration, a wallet without
      Solana or signing, connect, decline, account change, sign (HOO-1616;
      after 1.1)
- [x] 1.3 `SolanaProvider` publishes the bridge's list to
      `PgWallet.standardWallets`; verify `components/Wallet/Settings.test.tsx`
      and the `connect` command's tests pass unchanged, and an e2e spec with a
      fake wallet registered in the page covers the spec's scenarios
      "An installed wallet is offered", "Connect from the terminal" and
      "Reload after connecting" (HOO-1616; after 1.2)
- [x] 1.4 Measure the production bundle before and after and put both sizes
      in the PR (HOO-1616; after 1.3)

## 2. Spike

- [x] 2.1 The spike's answer is design.md, "Deploy path and the external
      wallet": trace, three directions, recommendation, risks, follow-ups;
      verify it covers every point of HOO-1617's acceptance criteria and the
      follow-ups are asked of Slava (HOO-1617)

## 3. Fund the Playground wallet

Plan: [plans/3-fund-the-playground-wallet.md](plans/3-fund-the-playground-wallet.md)

- [ ] 3.1 `features/fund-wallet` model: receiver choice, amount parsing and
      the balance check, the transfer through `PgTx.send` with the paying
      wallet, error classification (rejected, network, unknown); verify with
      in-source tests (HOO-1615; after 1.2)
- [ ] 3.2 `features/fund-wallet` telemetry: declare and describe
      `fund_dialog_opened`, `fund_wallet_connected`, `fund_sent`,
      `fund_failed`, register prefix `fund`; verify with tests through the
      memory provider and `slice-structure.test.ts` (HOO-1615; after 3.1)
- [ ] 3.3 `BaseFundDialog` and `FundDialog` from design-system parts with the
      spec's labels and ids; verify with React tests for every scenario of
      the dialog's requirements (HOO-1615; after 3.2)
- [ ] 3.4 `session-footer`: the "Fund from a wallet" item, shown when a
      Playground account exists, `item: "fund-wallet"`; verify with
      `BaseAccountMenu.test.tsx` and an e2e spec "client-v2-wallet-funding:
      Successful funding" with a fake wallet and a stubbed RPC (HOO-1615;
      after 3.3)
