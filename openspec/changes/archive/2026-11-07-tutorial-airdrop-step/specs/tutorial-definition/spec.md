## ADDED Requirements

### Requirement: An act can be an airdrop

An act beat MAY be `act: "airdrop"`. It names no instruction and no account.
A lesson SHALL carry an airdrop act before every `deploy` or `buildDeploy`
act, since the previous deploy act, in the same step or an earlier one. Beats
are counted in order across steps, each step's own beats before its `onFail`.
The airdrop act passes by itself when the wallet already holds enough, so a
funded learner presses nothing, and a later one is never shown to them. The definition check SHALL refuse a deploy act
with no airdrop act since the last deploy act, naming that act's id: the
first deploy as "an airdrop act before the first deploy", a later one as "an
airdrop act since the last deploy".

#### Scenario: Hello Anchor funds before it deploys (manual)
- **WHEN** the definition check reads Hello Anchor
- **THEN** the act `s2.airdrop` comes before the act `s2.deploy`, the act
  `s4.airdrop` comes before the act `s4.ship`, and the check passes

#### Scenario: A deploy with no airdrop before it (manual)
- **WHEN** a lesson's first deploy act `s2.deploy` has no airdrop act before it
- **THEN** the check fails with an error that names `s2.deploy`

#### Scenario: A later deploy with no airdrop since the last one (manual)
- **WHEN** a lesson funds and deploys in step 2, and its step 4 act `s4.ship`
  builds and deploys with no airdrop act between them
- **THEN** the check fails with an error, "an airdrop act since the last
  deploy", that names `s4.ship`

#### Scenario: A deploy in a planned failure counts after the step's beats (manual)
- **WHEN** a step's own beats end with an airdrop and a deploy, and its
  `onFail` holds another deploy act with no airdrop before it
- **THEN** the check fails with an error that names the `onFail` deploy act

#### Scenario: An airdrop act names an instruction (manual)
- **WHEN** an airdrop act carries `call`
- **THEN** the check fails, as it does for every act other than `call`
