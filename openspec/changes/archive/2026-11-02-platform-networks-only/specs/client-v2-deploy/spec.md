## MODIFIED Requirements

### Requirement: The stage names who pays

Before a deploy, the Deploy stage SHALL show one line naming the wallet that
pays: "Deploys from your Playground wallet · {short address} · {balance} SOL",
the address shortened in the middle. With no Playground wallet yet, the line
SHALL read "Deploys from a Playground wallet created on your first deploy."
The deploy action SHALL stay pressable without a wallet once the program is
built. The deploy action and every line of the stage SHALL name the network
capitalised ("Deploy to Devnet", "Deployed to Mainnet").

#### Scenario: No wallet yet (manual)

- **WHEN** a browser with no Playground wallet opens the built Deploy stage
- **THEN** the who-pays line says a wallet is created on the first deploy and
  "Deploy to Devnet" is pressable

### Requirement: A deploy from the stage creates the wallet it needs

When the user presses the stage's deploy action and no wallet is connected,
the stage SHALL connect the Playground wallet before the deploy runs: the
first existing account, or a new account when the browser has none. No
dialog and no terminal question SHALL appear for it. A deploy typed in the
terminal SHALL keep the terminal's connect question.

#### Scenario: First deploy in a fresh browser (manual)

- **WHEN** a fresh browser builds the program and presses "Deploy to Devnet"
- **THEN** a Playground wallet exists afterwards and no wallet dialog or
  terminal question appeared

### Requirement: History links open each record's network

Each history record SHALL keep the network it was deployed to, the deploy's
transaction signature and its cost. Each row's Explorer link SHALL open the
record's network, whatever network is picked now, and its label SHALL name
that network capitalised ("Explorer (Devnet)"). Records written without a
signature or cost SHALL still list.

#### Scenario: client-v2-deploy: A devnet record viewed on testnet

- **WHEN** the history holds a devnet record and the picked network is testnet
- **THEN** that row's Explorer link reads "Explorer (Devnet)" and its address
  carries `cluster=devnet`
