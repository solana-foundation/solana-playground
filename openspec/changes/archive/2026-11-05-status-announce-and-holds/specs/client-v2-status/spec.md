## ADDED Requirements

### Requirement: A change to Not ready is announced once

Flow SHALL mount one visually hidden `role="status"` region. It SHALL say an indicator's name and state once ("Rust analyzer, failed", "Devnet, not responding") when the indicator's words change to a Not ready or Failed state. It SHALL say nothing on the first render, on Working to Ready, or for what the line over the stage says already: all three indicators while offline, and the network on Deploy and Interact. Where no stage shows, as on Home, nothing counts as said already. A recovery SHALL clear the region, so a second episode is announced again.

#### Scenario: The analyzer fails (manual)

- **WHEN** the Rust analyzer goes from Starting to Failed
- **THEN** the region reads "Rust analyzer, failed", once

#### Scenario: A start that ends well (manual)

- **WHEN** an indicator goes from Working to Ready
- **THEN** the region says nothing

#### Scenario: The notice says it already

- **WHEN** the browser goes offline, or the cluster stops answering with Deploy or Interact showing
- **THEN** the region leaves that out, and the line over the stage says it

#### Scenario: A second episode (manual)

- **WHEN** an announced indicator recovers and goes down again the same way
- **THEN** the region is cleared at the recovery and says it again

### Requirement: Deploy and Interact wait for the network

While the browser is offline or the cluster does not answer, as the network indicator reads it, Deploy's pill and Interact's Test SHALL be disabled, with the reason where each gives its reason today: the pill's tooltip, and the line beside Test: "You're offline" or "Devnet is not responding". The notice over the stage is the visible reason where there is no tooltip. A cluster still connecting SHALL hold nothing. The `deploy` command SHALL refuse to start with "<reason>. Deploy waits for the network.", printed as its own line; pausing or resuming a deploy under way SHALL still work.

#### Scenario: The cluster does not answer

- **WHEN** a built project shows Deploy and the cluster does not answer
- **THEN** the pill is disabled, its tooltip reads "Devnet is not responding", and the notice over the stage says so

#### Scenario: Offline on Interact (manual)

- **WHEN** the form is filled and a wallet is connected, and the browser goes offline
- **THEN** Test is disabled and the line reads "You're offline"

#### Scenario: A deploy from elsewhere

- **WHEN** the assistant, the file menu or the terminal runs `deploy` with the cluster down
- **THEN** nothing is sent, the terminal prints "Devnet is not responding. Deploy waits for the network.", and Deploy keeps the state it had rather than reading failed

## MODIFIED Requirements

### Requirement: The Rust analyzer indicator

The Rust analyzer indicator SHALL read "Rust" (no state, grey dot) until a
Rust file starts the analyzer; "Rust · Starting <n> s" while it starts;
"Rust · Taking longer" once the start has run 60 s; "Rust · Ready" once it
answers; "Rust · Failed" when the start throws; and "Rust · Off" where the
browser cannot run it (the page is not cross-origin isolated). Its name SHALL
say the same, as "Rust analyzer, starting, 12 seconds". A click SHALL open a
panel that says what the analyzer does, its state in words, and, once it
takes longer or has failed, offers "Reload"; a start in its first minute
offers nothing to press. While a build or a deploy runs the panel SHALL NOT
offer "Reload", because a reload would throw that run away and a first build
does not start again; it SHALL say "Reload comes back when the build ends."
or "Reload comes back when the deploy ends."

#### Scenario: Analyzer state in words (manual)

- **WHEN** the analyzer start has run 12 s, then 60 s, then answers
- **THEN** the indicator reads "Rust · Starting 12 s", then "Rust · Taking
  longer", then "Rust · Ready"

#### Scenario: The analyzer's panel (manual)

- **WHEN** a user clicks the Rust analyzer indicator once its start has
  taken longer than 60 s
- **THEN** a panel says that code builds as normal and hints return when it
  is ready, and offers "Reload"

#### Scenario: A build under way keeps its Reload away (manual)

- **WHEN** the analyzer has taken longer than 60 s or failed, and a build runs
- **THEN** the panel offers no "Reload" and says it comes back when the build ends
