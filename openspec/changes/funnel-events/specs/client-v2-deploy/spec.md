# Spec Delta

## MODIFIED Requirements

### Requirement: Deploy events

The `features/deploy` slice SHALL emit, with prefix `deploy`:

- `deploy_started` when a deploy starts, with `cluster`, `kind` and `via`;
- `deploy_succeeded` when the program is deployed, with `cluster`, `kind`
  and `via`;
- `deploy_failed` when the deploy stops with an error, with `cluster`,
  `kind`, `via` and `step` (`checks`, `funding`, `buffer`, `write`,
  `authority`, `deploy`);
- `deploy_sol_needed_shown` when the "Not enough SOL" card shows, with
  `cluster` and `reason` (`signed_out`, `no_faucet`, `airdrop_failed`);
- `deploy_backup_shown`, `deploy_backup_saved` and `deploy_backup_dismissed`
  for the backup line, with no parameters.

`cluster` is `playnet`, `localnet`, `devnet`, `testnet` or `mainnet-beta`
for an endpoint the Playground offers, and `custom` for any other endpoint,
with nothing derived from its URL. `kind` is `first`, or `upgrade` when the
program is already on the cluster. `via` is `stage`, `terminal` or
`assistant`. `step` is `checks` for the wallet and program checks, and
`authority` for the transaction that hands the buffer's authority to a
paying extension wallet, which then becomes the program's upgrade
authority. A stop or a cancelled stale-build question sends no
`deploy_failed`.

No event SHALL carry an address, a program id, a signature, an RPC URL or an
amount.

#### Scenario: Events of a stage deploy (manual)

- **WHEN** a first deploy from the stage on devnet succeeds
- **THEN** `deploy_started` and `deploy_succeeded` are sent with
  `cluster: "devnet"`, `kind: "first"` and `via: "stage"`

#### Scenario: A failed write is tracked (manual)

- **WHEN** an upgrade typed as `deploy` in the terminal fails while the
  buffer is written
- **THEN** `deploy_failed` is sent with `kind: "upgrade"`,
  `via: "terminal"` and `step: "write"`

#### Scenario: A custom RPC (manual)

- **WHEN** the Playground's endpoint is an RPC URL the user typed in, on a
  cluster whose genesis is devnet's, and a deploy starts
- **THEN** `deploy_started` is sent with `cluster: "custom"`

## ADDED Requirements

### Requirement: Every deploy is counted once, from the command they share

The Deploy stage (`PgStageDeploy.start`), the terminal, and the assistant
(`realBridge.deploy` in `views/sidebar/assistant/bridge/playground-bridge.ts`)
all run the `deploy` command in `commands/deploy/deploy.ts`, which SHALL send
the three run events. Its `preChecks` SHALL send `deploy_started` before the
checks when `PgGlobal.deployState` is `ready`, and `deploy_failed
{step: "checks"}` when a check throws. Its `handle` SHALL send
`deploy_succeeded`, or `deploy_failed` with the step reached. A pause or
resume press SHALL send nothing.

#### Scenario: The assistant deploys (manual)

- **WHEN** a user approves the assistant's deploy and the deploy succeeds
- **THEN** `deploy_started` and `deploy_succeeded` are sent once each with
  `via: "assistant"`, and no event is sent with `via: "terminal"`

#### Scenario: A pause press (manual)

- **WHEN** a user types `deploy` while a deploy writes its buffer
- **THEN** the deploy pauses and no second `deploy_started` is sent

#### Scenario: A failed check is counted (manual)

- **WHEN** a user types `deploy` and the program's upgrade authority is
  another wallet
- **THEN** `deploy_started` and then `deploy_failed` with `step: "checks"`
  are sent

### Requirement: The deploy names its caller

`PgDeployRun` in `commands/deploy/run.ts` SHALL hold the running deploy's
`via`: `stage` for a run inside `PgDeployRun.withAnswers`, `assistant` for
the run `realBridge.deploy` starts, and `terminal` for any other run. The
`deploy` command SHALL read `via` from it and SHALL NOT change what the
command asks or does for any caller.

#### Scenario: A typed deploy (manual)

- **WHEN** a user types `deploy` in the terminal
- **THEN** every event of that run carries `via: "terminal"`

### Requirement: A stage deploy whose wallet does not connect is counted

`PgStageDeploy.start` in `features/deploy/model/stage-deploy.ts` SHALL send
`deploy_started` and then `deploy_failed {step: "checks", via: "stage"}`
when the Playground wallet does not connect, since the `deploy` command
never runs then. It SHALL send no other run event, and SHALL keep sending
`deploy_sol_needed_shown` and `deploy_backup_*`.

#### Scenario: The stage's wallet does not connect (manual)

- **WHEN** a user presses Deploy in the stage and the Playground wallet does
  not connect in time
- **THEN** `deploy_started` and then `deploy_failed` are sent with
  `step: "checks"` and `via: "stage"`

### Requirement: The authority step is telemetry only

The `deploy` command SHALL report `step: "authority"` for a failure in the
`setBufferAuthority` transaction it sends for an extension wallet, between
the write and the deploy. The Deploy stage's progress list SHALL keep its
four steps.

#### Scenario: The handover fails (manual)

- **WHEN** a deploy paid by an extension wallet fails while the buffer's
  authority is handed to that wallet
- **THEN** `deploy_failed` is sent with `step: "authority"`, and the stage
  showed no fifth step
