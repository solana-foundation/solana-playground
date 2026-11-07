## MODIFIED Requirements

### Requirement: The URL rule

A URL SHALL be saved only when it starts with `https://`, or with `http://` on `localhost` or `127.0.0.1`. Any other value SHALL show "Enter a URL that starts with https://, or http:// for a local validator." under the field and save nothing. Any URL that passes this rule SHALL be accepted, one a chip offers (Devnet or Mainnet) or a saved RPC has included. Only an entry with the same name and the same URL as a chip or a saved RPC SHALL be refused, with "Already saved as {name}." A save the browser refuses to store SHALL show "Could not save in this browser."

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

### Requirement: The list stays in this browser

The saved RPCs SHALL be stored in this browser only, names and URLs, under a `localStorage` key of their own. A profile whose connection endpoint is a custom URL that no chip and no saved RPC lists SHALL see it added, named by its host (Testnet and Localnet by their names), and checked. An address a chip offers SHALL never be added this way; a public address (the public Devnet or Mainnet) is added when its chip is on a platform RPC, since no chip lists it then.

#### Scenario: A custom endpoint from before is listed

- **WHEN** a profile already on a custom endpoint URL, written without a trailing slash, opens Settings
- **THEN** that URL is a chip named by its host, and checked

## ADDED Requirements

### Requirement: Chips that share a URL

Chips MAY share a URL. When several list the URL in use, exactly one SHALL be checked: the one picked or saved last, kept in this browser across a reload, while the network is still on its URL; else the first that lists it, Devnet and Mainnet before saved RPCs. Editing a chip that is not the checked one SHALL NOT move the network, though the network is on its URL. A click on a chip whose URL is already in use SHALL move the check and leave the network as it is. Removing a picked RPC while another chip still lists its URL SHALL leave the network where it is. A URL picked through a custom RPC SHALL stay that URL after a reload, even when it is the public URL of a network a chip offers on another RPC.

#### Scenario: The public Devnet beside Devnet on a platform RPC (manual)

- **WHEN** Devnet is on a platform RPC and a person saves `https://api.devnet.solana.com` as "Public Devnet"
- **THEN** "Public Devnet" is checked and the network is the public Devnet
- **AND** after a reload it still is

