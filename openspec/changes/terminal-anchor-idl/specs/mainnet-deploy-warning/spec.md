# Spec Delta

## MODIFIED Requirements

### Requirement: Anchor IDL writes to mainnet are refused

When the `anchor` command runs an `idl` subcommand that sends a transaction
while the endpoint it sends to is mainnet-beta, it SHALL refuse before any
transaction, printing one terminal line that says writing an IDL to mainnet is
not available in the beta and to run `anchor idl` from the user's own machine.
`init`, `upgrade`, `close`, `create-buffer`, `set-buffer-authority`, and
`write-buffer` are the `idl` subcommands that send a transaction; every other
subcommand, and `-h` and `--help`, SHALL run on any network. The cluster SHALL
be read from the endpoint, a custom RPC by its genesis hash, with the check
the `deploy` command uses; an endpoint that does not answer which network it
serves SHALL be refused, and one whose genesis hash names no known cluster
SHALL run. An endpoint changed between that read and the subcommand's first
send SHALL be refused. While such a subcommand runs, a network switch the user
asks for, in Settings or from the Deploy stage, SHALL be refused with a toast
saying an anchor idl command is running. On every other cluster the
subcommands SHALL run as `client-v2-program-idl` requires.

#### Scenario: IDL init on mainnet (manual)

- **WHEN** the endpoint is mainnet-beta and the user runs `anchor idl init`
- **THEN** the terminal prints the refusal line and no transaction is sent

#### Scenario: IDL close on mainnet (manual)

- **WHEN** the endpoint is mainnet-beta and the user runs
  `anchor idl close <PROGRAM_ID>`
- **THEN** the terminal prints the refusal line and no transaction is sent

#### Scenario: IDL fetch on mainnet (manual)

- **WHEN** the endpoint is mainnet-beta and the user runs
  `anchor idl fetch <PROGRAM_ID>`
- **THEN** the terminal prints the program's published IDL, or the line for a
  program without one, and not the mainnet refusal

#### Scenario: Network switch during an IDL write (manual)

- **WHEN** `anchor idl init` runs on devnet and the user picks Mainnet in
  Settings or presses the Deploy stage's "Show Mainnet"
- **THEN** a toast says an anchor idl command is running and the network stays

#### Scenario: IDL write on devnet (manual)

- **WHEN** the endpoint is devnet and the user runs `anchor idl init`
- **THEN** no refusal line is printed and the upload runs
