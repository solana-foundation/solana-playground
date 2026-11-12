# client-v2-custom-rpcs Specification

## Purpose

Lets a person keep several RPC endpoints of their own in this browser and pick one in Settings, Network, beside the networks Settings offers.

## Requirements

### Requirement: Saved custom RPCs are network chips

The Network row's radio group (`aria-label="Network"`) SHALL show Mainnet, Devnet, Testnet, Localnet, Surfpool, then one chip per saved custom RPC, in the order they were saved, labelled with the RPC's name. Picking a chip SHALL set the connection endpoint to that RPC's URL. On a narrow window the chips SHALL wrap and never scroll sideways.

#### Scenario: Two saved RPCs survive a reload

- **WHEN** a person saves two custom RPCs and reloads the page
- **THEN** both chips are in the Network row after the five offered networks
- **AND** the RPC picked last is still checked

#### Scenario: Picking a custom chip moves the connection

- **WHEN** a person picks a saved custom RPC's chip
- **THEN** RPC requests go to that RPC's URL

### Requirement: Adding a custom RPC

An "Add custom RPC" button SHALL open an inline form with a "Name" field, an "RPC URL" field and a "Save" button, under the help line "Any Solana RPC URL. It stays in this browser." Save or Enter SHALL save a valid entry and pick it. An empty name SHALL save as the URL's host, or as "Testnet" for the public Testnet's address while the Testnet chip is on a platform RPC; a name SHALL be at most 32 characters. "Cancel" SHALL close the form and save nothing.

#### Scenario: A new RPC is saved and picked

- **WHEN** a person adds `https://rpc.example.com/?api-key=k` with the name "Helius"
- **THEN** a chip "Helius" appears and is checked

#### Scenario: An unnamed RPC is named by its host

- **WHEN** a person adds `https://rpc.example.com/v1/k` with no name
- **THEN** its chip reads `rpc.example.com`

### Requirement: The URL rule

A URL SHALL be saved only when it starts with `https://`, or with `http://` on `localhost` or `127.0.0.1`. Any other value SHALL show "Enter a URL that starts with https://, or http:// for a local validator." under the field and save nothing. Any URL that passes this rule SHALL be accepted, one a chip offers (one of the offered networks) or a saved RPC has included. Only an entry with the same name and the same URL as a chip or a saved RPC SHALL be refused, with "Already saved as {name}." A save the browser refuses to store SHALL show "Could not save in this browser."

#### Scenario: A value that is not an https URL is refused

- **WHEN** a person saves `devnet` or `http://api.devnet.solana.com`
- **THEN** the field shows "Enter a URL that starts with https://, or http:// for a local validator."
- **AND** nothing is saved

#### Scenario: A local validator over plain HTTP is accepted

- **WHEN** a person saves `http://localhost:8899`
- **THEN** it is saved and picked

#### Scenario: A duplicate URL is refused

- **WHEN** a person saves a URL that a saved RPC already has, under that RPC's name
- **THEN** the field shows "Already saved as {that RPC's name}."

#### Scenario: A saved URL is accepted under another name

- **WHEN** a person saves a URL that a saved RPC or a chip already has, under another name
- **THEN** it is saved and picked, beside the other
- **AND** its chip is the one checked

### Requirement: Editing and removing a saved RPC

Each saved RPC SHALL have an "Edit {name}" and a "Remove {name}" button. Edit SHALL open the form filled in and save under the same rules. Remove SHALL drop the RPC and show a toast "Removed {name}." with "Undo"; removing the picked RPC SHALL set the network to Devnet and say "Removed {name}. Network is Devnet now." Undo SHALL put the RPC back where it was and re-pick it if it was picked and the network is still Devnet. A remove or an Undo the browser cannot store SHALL say "Could not remove {name}." or "Could not put {name} back."

#### Scenario: Editing renames the chip

- **WHEN** a person edits a saved RPC's name to "Triton"
- **THEN** its chip reads "Triton"
- **AND** if it was picked, the connection follows its new URL

#### Scenario: Removing the picked RPC lands on Devnet

- **WHEN** a person removes the picked custom RPC
- **THEN** Devnet is checked
- **AND** a toast says "Removed {name}. Network is Devnet now." with "Undo"

#### Scenario: Removing an RPC not in use keeps the network

- **WHEN** a person removes a saved RPC other than the picked one, then presses "Undo"
- **THEN** the toast says "Removed {name}." and the picked network stays checked throughout
- **AND** the removed RPC's chip is back where it was

### Requirement: The list stays in this browser

The saved RPCs SHALL be stored in this browser only, names and URLs, under a `localStorage` key of their own. A profile whose connection endpoint is a custom URL that no chip and no saved RPC lists SHALL see it added, named by its host (the public Testnet by its name), and checked. An address a chip offers SHALL never be added this way; a public address (the public Mainnet, Devnet or Testnet) is added when its chip is on a platform RPC, since no chip lists it then.

#### Scenario: A custom endpoint from before is listed

- **WHEN** a profile already on a custom endpoint URL, written without a trailing slash, opens Settings
- **THEN** that URL is a chip named by its host, and checked

### Requirement: The Network row is the only network control

Settings SHALL offer the network only in the Network row (its chips and the custom RPC list). No other section SHALL show a control for the RPC endpoint; the other connection settings keep their rows (Commitment sits in Advanced).

#### Scenario: No endpoint select in Settings

- **WHEN** a person opens Settings
- **THEN** Advanced shows the Commitment row, and no section has an "Endpoint" row or a control offering Custom
- **AND** the Network row's chips still pick the network

### Requirement: A custom RPC URL is checked for an answer before it is saved

Saving a custom RPC whose URL is new to the list (an add, or an edit that changes the URL) SHALL, once the URL passes the URL rule and is not a duplicate, send one health request to it and wait at most 5 s. While it waits, the "Save" button SHALL show a spinner, the form's fields SHALL be read-only, and "Cancel" and the list's "Add custom RPC", "Edit {name}" and "Remove {name}" buttons SHALL be disabled. Any HTTP answer within 5 s SHALL save and pick the RPC. With no answer in 5 s, or a request the browser cannot complete, the field SHALL show "This URL is not responding." and a "Use anyway" button, and save nothing; "Use anyway" SHALL save and pick the RPC. Changing the URL SHALL clear that error; changing the name SHALL clear it too, since "Use anyway" saves what was checked, while a refusal by the URL rule or as a duplicate stays until the URL changes. A save that fails unexpectedly SHALL show "Could not save in this browser." and leave the form editable. When the browser reports it is offline, no request SHALL be sent and the field SHALL show "You're offline, so this URL can't be checked." with the same "Use anyway" button. An edit that keeps the URL SHALL save at once, with no request. A value refused by the URL rule or as a duplicate SHALL send no request.

#### Scenario: A URL that answers is saved

- **WHEN** a person adds `https://api.devnet.solana.com` under a name of their own and the URL answers within 5 s
- **THEN** a spinner shows in "Save" while it waits
- **AND** the RPC is saved and its chip is checked, with no prompt

#### Scenario: A URL that does not answer offers Use anyway

- **WHEN** a person adds `https://example.invalid`
- **THEN** within 5 s the field shows "This URL is not responding." and a "Use anyway" button, and nothing is saved
- **AND** pressing "Use anyway" saves the RPC and checks its chip

#### Scenario: Offline, nothing is sent

- **WHEN** the browser is offline and a person saves a valid custom URL
- **THEN** the field shows "You're offline, so this URL can't be checked." and "Use anyway"
- **AND** no request is sent and nothing is saved until "Use anyway" is pressed

#### Scenario: A rename sends no request

- **WHEN** a person edits a saved RPC's name and keeps its URL
- **THEN** it saves at once and no request is sent

### Requirement: Custom RPC telemetry

The `settings-page` widget SHALL send `settings_custom_rpc_saved` when an RPC is saved (`mode`: `add` or `edit`; `check`: `passed` when the URL answered, `used_anyway` when saved through "Use anyway", `none` when no request was needed), `settings_custom_rpc_removed` when one is removed (`picked`: `true` or `false`), and `settings_custom_rpc_refused` when a save is refused (`reason`: `format`, `duplicate`, `storage`, `no_answer` or `offline`). No event SHALL carry a URL, a host or a name.

#### Scenario: Events carry no address (manual)

- **WHEN** a person adds, edits, refuses and removes a custom RPC
- **THEN** each event fires with only the parameters above

#### Scenario: Use anyway is told apart (manual)

- **WHEN** a URL does not answer and the person presses "Use anyway"
- **THEN** `settings_custom_rpc_refused` fires with `reason: no_answer`, then `settings_custom_rpc_saved` with `check: used_anyway`

### Requirement: Chips that share a URL

Chips MAY share a URL. When several list the URL in use, exactly one SHALL be checked: the one picked or saved last, kept in this browser across a reload, while the network is still on its URL; else the first that lists it, the offered networks before saved RPCs. Editing a chip that is not the checked one SHALL NOT move the network, though the network is on its URL. A click on a chip whose URL is already in use SHALL move the check and leave the network as it is. Removing a picked RPC while another chip still lists its URL SHALL leave the network where it is. A URL picked through a custom RPC SHALL stay that URL after a reload, even when it is the public URL of a network a chip offers on another RPC.

#### Scenario: The public Devnet beside Devnet on a platform RPC (manual)

- **WHEN** Devnet is on a platform RPC and a person saves `https://api.devnet.solana.com` as "Public Devnet"
- **THEN** "Public Devnet" is checked and the network is the public Devnet
- **AND** after a reload it still is

### Requirement: A saved RPC shows its URL with its key masked

The list of saved RPCs (`aria-label="Custom RPCs"`) SHALL show each RPC's name and its whole stored URL, with every secret in it replaced by `••••`, always four dots whatever the secret's length. A secret SHALL be: a non-empty query value whose name looks like a key (it contains `key`, `token`, `secret`, `auth`, `pass`, `sig` or `credential`, in any case); any host label, path segment, query value, bare query term or fragment that looks like a token, 16 or more of letters, digits, `-`, `_`, `.`, `~`, `+`, `=` or `%` with a digit, or 24 or more in mixed case; and a username or password. A stored value that is not a URL SHALL show as `••••` alone. When anything was masked, an "API key" badge SHALL show beside the URL. The stored URL SHALL not change, and the full URL SHALL appear only inside the edit field.

#### Scenario: A key in the query is masked

- **WHEN** a saved RPC's URL is `https://devnet.helius-rpc.com/?api-key=secret`
- **THEN** the page shows `https://devnet.helius-rpc.com/?api-key=••••` and an "API key" badge
- **AND** no text containing `secret`, outside the edit field

#### Scenario: A key in the path is masked

- **WHEN** a saved RPC's URL is `https://mainnet.rpc.test/v2/abc123def456ghi789`
- **THEN** the page shows `https://mainnet.rpc.test/v2/••••` and an "API key" badge

#### Scenario: A URL with no key shows in full

- **WHEN** a saved RPC's URL is `https://rpc.example.com/`
- **THEN** the page shows `https://rpc.example.com/` and no "API key" badge

### Requirement: A network chip is stored as its key

The settings SHALL store the connection endpoint as the picked chip's key (`mainnet-beta`, `devnet`, `testnet`,
`localnet`, `surfpool`), and as a URL only for a custom RPC. A stored key SHALL read back as the URL its chip opens
on the next load, so a platform RPC URL, its API key included, is never written to `localStorage`. The Mainnet,
Devnet and Testnet chips SHALL open the URL that `REACT_APP_MAINNET_RPC_URL`, `REACT_APP_DEVNET_RPC_URL` and
`REACT_APP_TESTNET_RPC_URL` name, or the cluster's public RPC when the variable is unset or empty. A public URL picked
as a custom RPC while its chip opens a platform RPC SHALL be stored as that custom URL and stay picked after a reload.

#### Scenario: A rotated platform key reaches the profile (manual)

- **WHEN** a profile on the Devnet chip reloads after the env's `REACT_APP_DEVNET_RPC_URL` changed its API key
- **THEN** the connection uses the new URL, and `localStorage` holds `devnet` for the endpoint, never the URL

#### Scenario: The public Devnet as a custom RPC beside a platform Devnet (manual)

- **WHEN** the env sets `REACT_APP_DEVNET_RPC_URL` and a person saves and picks `https://api.devnet.solana.com` as a
  custom RPC, then reloads
- **THEN** the `api.devnet.solana.com` chip is still checked and RPC requests go to `https://api.devnet.solana.com`
