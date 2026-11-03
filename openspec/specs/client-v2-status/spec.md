# client-v2-status Specification

## Purpose
Says whether the network, the AI and the Rust analyzer are ready, in one
pattern on every width, so a slow start never reads as a broken one and a
person can name what is not ready from the indicator alone.

## Requirements

### Requirement: One indicator pattern in three states

The network, the AI and the Rust analyzer SHALL each show as one status
indicator: a dot and words, drawn as a button whose accessible name says the
indicator and its state. Each SHALL be in one of three states: ready (green
dot), working (pulsing dot) or not ready (red dot). The words SHALL say the
state; colour SHALL never be the only sign.

#### Scenario: Three indicators in one pattern

- **WHEN** a user opens the app on a 1440 px wide window
- **THEN** the navigation's foot shows one status row with three buttons:
  the cluster ("Change cluster, currently <name>"), the AI (named starting
  "AI, ") and the Rust analyzer (named starting "Rust analyzer"), each with a
  dot and words

### Requirement: The network indicator

The network indicator SHALL show the cluster's name. While the connection
has not answered yet it SHALL be working and read "<Name> · Connecting";
when the cluster does not answer it SHALL be not ready, read "<Name> · Not
answering" and be named "Change cluster, currently <name>, not answering".
A click SHALL open the settings on the cluster, as the cluster row did.

#### Scenario: A cluster that stops answering

- **WHEN** the cluster stops answering
- **THEN** the network indicator's dot is red, it reads "<Name> · Not
  answering", and a click opens the settings on the cluster

### Requirement: The AI indicator

The AI indicator SHALL be ready while a model is connected and usable, show
the model's name and be named "AI, ready" (not the model's name, which the
composer's model button is named by). With no model connected,
or the default backend while nobody is signed in, it SHALL be not ready, read
"AI · Off" and be named "AI, off". A click SHALL open Connect a model.

#### Scenario: No model connected

- **WHEN** a signed-out user with no model connected opens the app
- **THEN** the AI indicator reads "AI · Off", and a click opens Connect a
  model

### Requirement: The Rust analyzer indicator

The Rust analyzer indicator SHALL read "Rust" (no state, grey dot) until a
Rust file starts the analyzer; "Rust · Starting <n> s" while it starts;
"Rust · Taking longer" once the start has run 60 s; "Rust · Ready" once it
answers; "Rust · Failed" when the start throws; and "Rust · Off" where the
browser cannot run it (the page is not cross-origin isolated). Its name SHALL
say the same, as "Rust analyzer, starting, 12 seconds". A click SHALL open a
panel that says what the analyzer does, its state in words, and, once it
takes longer or has failed, offers "Reload"; a start in its first minute
offers nothing to press.

#### Scenario: Analyzer state in words (manual)

- **WHEN** the analyzer start has run 12 s, then 60 s, then answers
- **THEN** the indicator reads "Rust · Starting 12 s", then "Rust · Taking
  longer", then "Rust · Ready"

#### Scenario: The analyzer's panel (manual)

- **WHEN** a user clicks the Rust analyzer indicator once its start has
  taken longer than 60 s
- **THEN** a panel says that code builds as normal and hints return when it
  is ready, and offers "Reload"

### Requirement: Offline reads on every indicator

While the browser reports no connection, all three indicators SHALL be not
ready and read "<Name> · Offline" ("AI · Offline", "Rust · Offline"), and their panels and sheet rows SHALL say
"You're offline. Editing still works. Build, Deploy and the assistant need a
connection." They SHALL return to their own state when the connection comes
back.

#### Scenario: Going offline and back

- **WHEN** the browser goes offline, then online again
- **THEN** the three indicators read "Offline" with red dots, then return to
  their own states

### Requirement: The rail shows three dots

On the collapsed navigation (the rail), the three indicators SHALL show as
three dot buttons, each named as its indicator and each doing what its
indicator does.

#### Scenario: The rail's dots

- **WHEN** a user on an 834 px wide window looks at the rail's foot
- **THEN** it shows three dot buttons: "Cluster: <name>", the AI's and the
  Rust analyzer's

### Requirement: The phone folds status into one chip

Below 768 px the work page's bar SHALL show one status chip with the worst
state: "Offline" while the browser reports no connection, "Ready" when all
are ready, "Starting" when one is working and none is not ready, "<n> not
ready" otherwise, named "Status, <words>". A tap SHALL open a sheet titled
"Status" with one row per indicator: its dot, name and state words, what it
means when not ready, and its action ("Change network", "Connect a model",
"Reload"). The chip, each row's action and the sheet's close SHALL be at
least 44 px tall.

#### Scenario: The phone chip names what is down

- **WHEN** a user on a 390 px wide screen with no model connected taps the
  status chip
- **THEN** the chip reads "1 not ready" or more, and the sheet lists
  Network, AI and Rust analyzer, with "AI · Off" and "Connect a model" on
  the AI row

#### Scenario: The phone chip reads Offline

- **WHEN** a user on a 390 px wide screen goes offline
- **THEN** the chip reads "Offline" and is named "Status, offline"

### Requirement: Status events

The slice SHALL send `status_indicator_picked` each time a user clicks an
indicator or a sheet row's action, with `indicator` (`network`, `ai`, `rust`),
`state` (`ready`, `working`, `not-ready`) and `from` (`row`, `rail`,
`sheet`); and `status_sheet_opened` each time the phone's sheet opens, with
`worst` (`ready`, `working`, `not-ready`). Connect a model opened from the AI
indicator SHALL send the assistant's `assistant_connect_opened` with `via:
"status"`, a new value of that event's `via`. The stage notice SHALL send
`status_notice_shown` once each time a notice appears, with `notice`
(`offline`, `cluster-down`), and `status_notice_action` each time a user
presses one of its actions, with `notice` (`cluster-down`) and `action`
(`retry`, `change-network`).

#### Scenario: Picking an indicator is measured

- **WHEN** a user clicks the AI indicator in the status row while no model
  is connected
- **THEN** `status_indicator_picked` is sent with `indicator: "ai"`,
  `state: "not-ready"`, `from: "row"`

#### Scenario: A notice is measured once per onset

- **WHEN** the browser goes offline on the Build stage and the user switches
  to Deploy and back
- **THEN** `status_notice_shown` is sent once, with `notice: "offline"`

### Requirement: A notice over the stage says why work waits

While the browser reports no connection, a warning line over the stage SHALL
say "You're offline. Editing still works. Build, Deploy and the assistant need a
connection." on every stage, and the Build stage's Build buttons SHALL be
disabled until the connection returns. While online, on the Deploy and
Interact stages, while the cluster does not answer or its slot does not move,
a warning line over the stage SHALL say "<Network> isn't answering.
Playground keeps trying. You can switch network." with two buttons: "Try
again", which asks the cluster again at once and is busy while it asks, and
"Change network", which opens the settings with the network field focused.
The Write and Build stages SHALL show no cluster notice. Each notice is a
`role="alert"` callout and SHALL clear by itself when its condition ends.

#### Scenario: Offline shows one line over the stage

- **WHEN** the browser goes offline on the Build stage
- **THEN** a line over the stage reads "You're offline. Editing still works.
  Build, Deploy and the assistant need a connection." and the Build button is
  disabled; back online, the line is gone and Build is enabled

#### Scenario: A cluster that does not answer on Deploy

- **WHEN** the cluster stops answering while the user is on the Deploy stage
- **THEN** a line over the stage reads "Devnet isn't answering. Playground
  keeps trying. You can switch network." with "Try again" and "Change
  network"

#### Scenario: Change network from the notice

- **WHEN** the user presses "Change network" on the cluster notice
- **THEN** the settings open with the network field focused

### Requirement: The setup list warns on a network that does not answer

While the chosen cluster does not answer or its slot does not move, the
"Choose a network" row of "Get set up" SHALL lose its tick and show its warn
state, with the cluster's name as its value and "<cluster> is not responding"
as its title and as the words read after its label; it SHALL NOT count as
done. It SHALL tick again when the cluster answers.

#### Scenario: The setup row warns while the cluster does not answer

- **WHEN** the cluster stops answering
- **THEN** the "Choose a network" row shows its warn state, titled "devnet
  is not responding", and the list counts one step fewer as done
