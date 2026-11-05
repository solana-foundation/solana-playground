# Spec Delta

## Purpose

Says whether the network, the AI and the Rust analyzer are ready, in one
pattern on every width, so a slow start never reads as a broken one and a
person can name what is not ready from the indicator alone.

## ADDED Requirements

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
"You're offline. You can keep editing. Building needs a connection." They
SHALL return to their own state when the connection comes back.

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
state: "Ready" when all are ready, "Starting" when one is working and none is
not ready, "<n> not ready" otherwise, named "Status, <words>". A tap SHALL
open a sheet titled "Status" with one row per indicator: its dot, name and
state words, what it means when not ready, and its action ("Change network",
"Connect a model", "Reload"). The chip, each row's action and the sheet's
close SHALL be at least 44 px tall.

#### Scenario: The phone chip names what is down

- **WHEN** a user on a 390 px wide screen with no model connected taps the
  status chip
- **THEN** the chip reads "1 not ready" or more, and the sheet lists
  Network, AI and Rust analyzer, with "AI · Off" and "Connect a model" on
  the AI row

### Requirement: Status events

The slice SHALL send `status_indicator_picked` each time a user clicks an
indicator or a sheet row's action, with `indicator` (`network`, `ai`, `rust`),
`state` (`ready`, `working`, `not-ready`) and `from` (`row`, `rail`,
`sheet`); and `status_sheet_opened` each time the phone's sheet opens, with
`worst` (`ready`, `working`, `not-ready`). Connect a model opened from the AI
indicator SHALL send the assistant's `assistant_connect_opened` with `via:
"status"`, a new value of that event's `via`.

#### Scenario: Picking an indicator is measured

- **WHEN** a user clicks the AI indicator in the status row while no model
  is connected
- **THEN** `status_indicator_picked` is sent with `indicator: "ai"`,
  `state: "not-ready"`, `from: "row"`
