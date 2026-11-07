# Spec Delta

## ADDED Requirements

### Requirement: Buffer writes are paced

A deploy SHALL send its buffer writes at one pace shared by all its workers. The pace SHALL start at 4 writes per
second, or at the cluster's send cap when that is lower. Each rate limit the RPC answers SHALL halve the pace, to no
less than 1 write per second unless a cap holds it lower, and end the round; the next round SHALL wait 10 seconds, after the terminal prints
"Warning: Reached rate-limits ({provider}: {reason}), waiting …". Every 10 accepted writes in a row SHALL raise the
pace by 1 write per second.

#### Scenario: A rate-limited write slows the deploy (manual)

- **WHEN** a deploy on devnet sends buffer writes faster than its RPC allows and the RPC answers 429
- **THEN** the terminal prints "Warning: Reached rate-limits" with the provider and its message, the deploy waits
  10 seconds, and the next round sends at half the pace

### Requirement: The send cap comes from the env per cluster

The pace SHALL never rise above the cluster's send cap: `REACT_APP_DEVNET_SEND_TX_PER_SECOND`,
`REACT_APP_TESTNET_SEND_TX_PER_SECOND` or `REACT_APP_MAINNET_SEND_TX_PER_SECOND`, in writes per second. The cap SHALL
apply to every RPC of that cluster: the platform RPC, the public one, and a custom RPC whose genesis hash names the
cluster. A cap that is unset, not a number, or not above 0 SHALL cap nothing, and the pace then rises to at most 20
writes per second.

#### Scenario: A capped cluster never sends faster than its cap (manual)

- **WHEN** `REACT_APP_DEVNET_SEND_TX_PER_SECOND` is `4` and a program of a few hundred chunks deploys to devnet
  with no rate limit
- **THEN** no second of the write sends more than 4 buffer writes

### Requirement: A load that lands no chunk fails

After each round of writes the deploy SHALL read the buffer and send again only the chunks that are missing or
differ. When 5 rounds in a row leave no fewer chunks missing than the round before, the load SHALL fail with "The RPC
kept refusing buffer writes: no chunk landed in 5 rounds in a row", followed by "(last rate limit: {provider}:
{reason})" when a rate limit was answered. A deploy typed in the terminal SHALL then ask "Writing the program failed.
Would you like to close the buffer account and reclaim SOL?", yes by default.

#### Scenario: An RPC that refuses every write (manual)

- **WHEN** a deploy typed in the terminal writes to an RPC that refuses every buffer write
- **THEN** after 5 rounds the terminal asks whether to close the buffer account and reclaim SOL, and a yes prints
  "Reclaim successful." and the load's error

### Requirement: A stage deploy closes its buffer without asking

When a deploy the Deploy stage started fails while it writes its buffer, the deploy SHALL close the buffer and return
its SOL to the paying wallet without a question in the terminal, and the stage SHALL show the load's failure. A
deploy typed in the terminal SHALL keep its question.

#### Scenario: A stage deploy whose write fails (manual)

- **WHEN** a deploy started from the Deploy stage fails after 5 rounds in which no chunk lands
- **THEN** the terminal asks nothing, the buffer account no longer exists, and the stage shows the failure

### Requirement: Buffer accounts are read through the read-buffer RPC

Every read of a deploy's buffer account SHALL go through the cluster's read-buffer RPC when the env sets one:
`REACT_APP_DEVNET_READ_BUFFER_RPC_URL`, `REACT_APP_TESTNET_READ_BUFFER_RPC_URL` or
`REACT_APP_MAINNET_READ_BUFFER_RPC_URL`. This covers deploys typed in the terminal, started from the Deploy stage,
and run by a tutorial. Sends and every other read SHALL stay on the selected RPC. An unset or empty value SHALL read
the buffer through the selected RPC.

#### Scenario: A platform RPC that lags on fresh buffers (manual)

- **WHEN** `REACT_APP_DEVNET_READ_BUFFER_RPC_URL` is `https://api.devnet.solana.com` and a program deploys to devnet
  through a platform RPC that does not return an account written seconds before
- **THEN** each round sends only the chunks the buffer lacks, and the deploy finishes

### Requirement: Settings names the read-buffer RPC

Under the network chips, Settings SHALL show, as text, the read-buffer RPC of the selected endpoint's cluster, with a
line saying that this RPC reads deploy buffers and that the CLI needs it to see them: `solana program show --buffers
-u <url>` lists them and `solana program close --buffers -u <url>` reclaims their SOL, each with the URL quoted as the
terminal's close command quotes it and a Copy button that copies that command. A copy SHALL send
`settings_buffer_command_copied` with `command` `show` or `close`; a copy that fails SHALL say so through the button's
failure report. A custom RPC SHALL show the read-buffer RPC of the cluster its genesis hash
names. While the env sets no read-buffer RPC for that cluster, or the cluster is unknown, the text SHALL be absent.

#### Scenario: Devnet with a read-buffer RPC (manual)

- **WHEN** `REACT_APP_DEVNET_READ_BUFFER_RPC_URL` is `https://api.devnet.solana.com` and the Devnet chip is checked
- **THEN** Settings shows `https://api.devnet.solana.com` under the chips, with `solana program show --buffers -u
  'https://api.devnet.solana.com'` and `solana program close --buffers -u 'https://api.devnet.solana.com'`, each
  with a Copy button

#### Scenario: Copying the close command (manual)

- **WHEN** the read-buffer text shows and the person presses the Copy button beside the close command
- **THEN** the clipboard holds `solana program close --buffers -u '<url>'` and `settings_buffer_command_copied` is
  sent with `command` `close`

#### Scenario: A cluster with no read-buffer RPC (manual)

- **WHEN** the env sets no `REACT_APP_MAINNET_READ_BUFFER_RPC_URL` and the Mainnet chip is checked
- **THEN** Settings shows no read-buffer text under the chips

### Requirement: The setting command reads the read-buffer RPC

The terminal's `setting` command SHALL accept the read-only key `connection.readBufferEndpoint` and list it with the
other setting keys. `setting get connection.readBufferEndpoint` SHALL print the RPC a deploy reads buffer accounts
through, from `PgConnection.getReadBufferConnection` on the selected connection: the read-buffer RPC of the selected
endpoint's cluster, or the selected endpoint itself while the env sets none for that cluster or the cluster is unknown.
`setting set connection.readBufferEndpoint` SHALL refuse any value with one line saying that the value comes from the
environment, and SHALL store nothing, since the env owns the read-buffer RPCs.

#### Scenario: Getting the read-buffer RPC the env sets (manual)

- **WHEN** `REACT_APP_DEVNET_READ_BUFFER_RPC_URL` is `https://api.devnet.solana.com`, the selected endpoint is a devnet
  platform RPC, and the person runs `setting get connection.readBufferEndpoint`
- **THEN** the terminal prints `https://api.devnet.solana.com`

#### Scenario: Getting the read-buffer RPC while the env sets none (manual)

- **WHEN** the env sets no `REACT_APP_MAINNET_READ_BUFFER_RPC_URL`, the Mainnet chip is checked, and the person runs
  `setting get connection.readBufferEndpoint`
- **THEN** the terminal prints the selected endpoint, the same value `setting get connection.endpoint` prints

#### Scenario: Setting the read-buffer RPC is refused (manual)

- **WHEN** the person runs `setting set connection.readBufferEndpoint https://example.com`
- **THEN** the terminal prints, in the error colour, the line "`connection.readBufferEndpoint` comes from the
  environment and can't be set here.", and localStorage is unchanged

### Requirement: The Deploy stage's faucet link names the wallet

The "Open faucet" link of the Deploy stage's "Not enough SOL" card SHALL open `https://faucet.solana.com` in a new tab
with the paying wallet's address and the cluster filled in, on a cluster the faucet serves. On any other cluster the
card SHALL show no faucet link.

#### Scenario: A devnet deploy without enough SOL

- **WHEN** a deploy started from the Deploy stage on devnet stops because the wallet holds too little SOL
- **THEN** its "Open faucet" link is `https://faucet.solana.com/?walletAddress=<address>&cluster=devnet`
