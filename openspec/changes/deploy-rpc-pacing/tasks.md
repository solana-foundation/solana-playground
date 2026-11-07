# Tasks

Groups 1 to 3 touch separate files and may run at the same time; inside group 1, 1.4 to 1.6 follow 1.1 to 1.3.

## 1. Buffer writes and reads (`client-v2-deploy`)

- [x] 1.1 Pace buffer writes in `BpfLoaderUpgradeable.loadBuffer` and cap them by
  `REACT_APP_*_SEND_TX_PER_SECOND` per cluster; verify with `yarn test-unit src/commands/deploy` (HOO-2362)
- [x] 1.2 Fail a load after `MAX_STALLED_ROUNDS` rounds that land no chunk, and offer the terminal deploy's reclaim
  question; verify with `yarn test-unit src/commands/deploy` (HOO-2362)
- [x] 1.3 Read buffer accounts through `PgConnection.getReadBufferConnection` on all three deploy paths, from
  `REACT_APP_*_READ_BUFFER_RPC_URL`; verify with `yarn test-unit src/utils/connection.read-buffer.test.ts` (HOO-2362)
- [ ] 1.4 Close the buffer without a terminal question when the Deploy stage started the deploy
  (`PgDeployRun.answers`); verify with a `deploy.test.ts` case that asserts no `waitForInput` and a closed buffer
  (HOO-2362)
- [ ] 1.5 Bound the read-buffer read in `loadUntilWritten`, log its first failure with the endpoint, and fail with an
  error that names the read-buffer RPC; verify with a `bpf-loader-upgradeable.test.ts` case on an RPC that never
  answers (ticket to file)
- [ ] 1.6 Guard the read-buffer wiring with a distinct buffer connection per deploy path and a wiring test for
  `realDeployPort().writeBuffer`; verify that reverting one `getAccountInfo` to the selected connection fails a test
  (ticket to file)

- [ ] 1.7 Show the selected cluster's read-buffer RPC under the Settings network chips, with the `solana program show
  --buffers -u` and `closeBuffersCommandFor` commands, each with a `CopyButton` (`onError={reportButtonFailure(...)}`),
  and nothing while the env sets none; declare and send `settings_buffer_command_copied` (`command`: `show` | `close`)
  in `widgets/settings-page/model/telemetry.ts`; depends on `cluster-entity` 2.1, which moves the same Settings
  section; verify with a `widgets/settings-page` test per state (set, unset, custom RPC on a known cluster) and one
  that asserts the event through the memory provider (HOO-2362)
- [x] 1.8 Add the read-only key `connection.readBufferEndpoint` to the terminal's `setting` command: `get` prints
  `PgConnection.getReadBufferConnection(PgConnection.current).rpcEndpoint`, `set` refuses and stores nothing; verify
  with `yarn test-unit src/commands/setting` (HOO-2362)

## 2. Stop and the console strip (`client-v2-command-stop`)

- [ ] 2.1 Show Stop for a build and hide it for a deploy in `BaseConsoleDrawer`, with Clear turned off beside Stop;
  verify by taking the three `client-v2-command-stop` build scenarios out of `e2e/known-skips.txt` and running
  `yarn test-e2e e2e/client-v2-command-stop.e2e.spec.ts` (HOO-2362)
- [ ] 2.2 Single-quote the read-buffer URL in `closeBuffersCommandFor`; verify with `yarn test-unit
  src/commands/deploy/stopped.test.ts` (HOO-2362)
- [x] 2.3 Draw the strip's progress bar from `PgView.setMainSecondaryProgress`; verify with `yarn test-unit
  src/views/flow/console` (HOO-2362)

## 3. Faucet links and the tutorial's write count (`tutorial-runs`, `client-run`)

- [x] 3.1 Fill the wallet address into the tutorial's and the docs link's faucet links, with 5 SOL on the tutorial
  deploy's card; verify with `yarn test-unit src/shared/lib/faucet.ts` and the `client-run: A new wallet` e2e test
  (HOO-2362)
- [x] 3.2 Report each landed write as the "Writing buffer" stage's "N of M transactions"; verify with `yarn test-unit
  src/features/tutorial-conversation/model/runners/deploy.ts` (HOO-2362)
- [x] 3.3 Print a "Note:" line after the tutorial deploy's "Deploying from" line saying most of the SOL is rent;
  verify with `yarn test-unit src/features/tutorial-conversation/model/runners/deploy.ts` (HOO-2362)
- [x] 3.4 Read the airdrop card's balance check on any known cluster in `tutorialRunner.isFunded`; verify with the
  `real-deploy.test.ts` localnet case (HOO-2362)
