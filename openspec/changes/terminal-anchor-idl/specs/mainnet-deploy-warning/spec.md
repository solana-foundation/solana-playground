# Spec Delta

## MODIFIED Requirements

### Requirement: Anchor IDL writes to mainnet are refused

When the `anchor` command runs `idl init` or `idl upgrade` while the endpoint
it sends to is mainnet-beta, it SHALL refuse before any transaction, printing
one terminal line that says writing an IDL to mainnet is not available in the
beta and to run `anchor idl` from the user's own machine. `init` and `upgrade`
are the `idl` subcommands that send a transaction; `-h` and `--help` only
print and SHALL run on any network. The cluster SHALL be read from the
endpoint, a custom RPC by its genesis hash, with the check the `deploy`
command uses; an endpoint that does not answer which network it serves SHALL
be refused, and one whose genesis hash names no known cluster SHALL run. An
endpoint changed between that read and the upload's start SHALL be refused.
While an `idl` write runs, a network switch the user asks for, in Settings or
from the Deploy stage, SHALL be refused with a toast saying an anchor idl
command is running. On every other cluster `idl init` and `idl upgrade` SHALL
run as `client-v2-program-idl` requires.

#### Scenario: IDL init on mainnet (manual)

- **WHEN** the endpoint is mainnet-beta and the user runs `anchor idl init`
- **THEN** the terminal prints the refusal line and no transaction is sent

#### Scenario: IDL fetch on mainnet (manual)

- **WHEN** the endpoint is mainnet-beta and the user runs `anchor idl fetch`
- **THEN** the terminal prints the not-supported line of
  `client-v2-program-idl`, not the mainnet refusal

#### Scenario: Network switch during an IDL write (manual)

- **WHEN** `anchor idl init` runs on devnet and the user picks Mainnet in
  Settings or presses the Deploy stage's "Show Mainnet"
- **THEN** a toast says an anchor idl command is running and the network stays

#### Scenario: IDL write on devnet (manual)

- **WHEN** the endpoint is devnet and the user runs `anchor idl init`
- **THEN** no refusal line is printed and the upload runs
