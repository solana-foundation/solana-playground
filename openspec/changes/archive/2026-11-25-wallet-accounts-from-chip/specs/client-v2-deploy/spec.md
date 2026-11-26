## MODIFIED Requirements

### Requirement: The stage names who pays

Before a deploy, the Deploy stage SHALL show one line naming the wallet that
pays: "From your Playground wallet · {short address} · {balance} SOL",
the address shortened in the middle and the balance to up to four decimals
("0 SOL" when empty). With two or more Playground accounts, the line SHALL
name the paying account in place of the wallet: "From {account} · {short
address} · {balance} SOL", the account the wallet chip's header names. With no Playground wallet yet, the line
SHALL read "From your Playground wallet · free devnet SOL" on devnet, the
only network the design's line names, and "From your Playground wallet" on
every other network, whether or not it airdrops, and while the cluster is
unknown.
The deploy action SHALL stay pressable without a wallet once the program is
built. Inside a sentence the deploy action and every line of the stage SHALL
name the network in lower case ("Deploy to devnet", "Deployed to mainnet");
standalone labels (pickers, chips, Explorer links) keep it capitalised.

#### Scenario: No wallet yet (manual)

- **WHEN** a browser with no Playground wallet opens the built Deploy stage
- **THEN** the who-pays line reads "From your Playground wallet · free devnet
  SOL" and "Deploy to devnet" is pressable

#### Scenario: Two Playground accounts (manual)

- **WHEN** the Playground wallet holds two accounts, "Wallet 2" is current, and the user opens the built
  Deploy stage
- **THEN** the who-pays line reads "From Wallet 2 · {short address} · {balance} SOL"
