## MODIFIED Requirements

### Requirement: History links open each record's network

Each history record SHALL keep the network it was deployed to, the deploy's
transaction signature and its cost. Each row's Explorer link SHALL open the
record's network, whatever network is picked now, and its accessible name
SHALL name the deployment and that network capitalised ("View deployment
({program id}) on Explorer (Devnet)"). On a desk the link's text SHALL read
"Explorer (Devnet)"; on a phone it SHALL read "Explorer", since the row names
its network. Records written without a signature or cost SHALL still list.

#### Scenario: A devnet record viewed on testnet

- **WHEN** the history holds a devnet record and the picked network is testnet
- **THEN** that row's Explorer link reads "Explorer (Devnet)" and its address
  carries `cluster=devnet`

#### Scenario: A history link on a phone (manual)

- **WHEN** a 390 px wide screen shows a devnet record in the history
- **THEN** its link reads "Explorer" and is named "View deployment ({program
  id}) on Explorer (Devnet)"

## ADDED Requirements

### Requirement: The facts of a first deploy sit in one card

Before the first deploy on the network picked (Spec 08's EMPTY-03), the Deploy
stage SHALL show the deploy's facts as rows of one card, under the title and
its line: a row named "Network" with the network's name and a "Change" link
that opens the settings on the network choice; a row named "IDL" with the
loaded IDL's program name, only while an IDL is loaded; once the program is
built and no deploy runs, the who-pays line of "The stage names who pays"; and
last, the program id, which unfolds into its keypair. The card SHALL leave out
the Network row while the cluster is unknown. After a deploy on the network
picked, the stage SHALL keep a card under the history with the IDL row, when an
IDL is loaded, and the program id.

#### Scenario: A built program before its first deploy (manual)

- **WHEN** a built project with a loaded IDL named "counter" opens the Deploy
  stage on devnet with no deployment there
- **THEN** one card lists Network "Devnet" with Change, IDL "counter", the
  who-pays line and the program id, in that order

#### Scenario: Change opens the network choice (manual)

- **WHEN** the user presses Change in the card's Network row
- **THEN** the settings open with focus on the network choice

### Requirement: A network with no deploy names where the others are

When the network picked has no deployment of the project and another network
has one (Spec 08's EMPTY-14), the Deploy stage, once the program is built and
the network is known, SHALL title itself "Nothing on {network}" and SHALL say
"This project has deploys on {other network}." with "Show {other network}" as a
link when the settings offer that network. Pressing the link SHALL switch the
connection to that network. The link SHALL be off while a deploy runs, because
the running deploy's record takes the network read when it ends.

#### Scenario: Deployed on devnet, mainnet picked (manual)

- **WHEN** the project has a devnet deployment and the picked network is
  mainnet
- **THEN** the title reads "Nothing on mainnet" and the line "This project has
  deploys on devnet. Show devnet"

#### Scenario: The switch waits for a running deploy (manual)

- **WHEN** a deploy runs on the network picked
- **THEN** "Show {other network}" is disabled
