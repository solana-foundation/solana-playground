# Spec Delta

## MODIFIED Requirements

### Requirement: The network indicator

The network indicator SHALL show the cluster's name. While the connection
has not answered yet it SHALL be working and read "<Name> · Connecting";
when the cluster does not answer it SHALL be waiting (warning dot), read
"<Name> · Not responding" and be named "Change cluster, currently <name>, not
responding". A click on a ready or connecting indicator SHALL open the
settings on the cluster, as the cluster row did. A click on an indicator
whose cluster does not answer, in the status row or on the rail, SHALL open
a panel titled "Network" with the indicator's words, the line "The cluster
is not responding. Write and Build work; Deploy and Interact wait for it." and
two buttons: "Try again", which asks the cluster again, shows "Trying…"
while it asks and, when the cluster still does not answer, says "Could not
reach the network."; and "Change network", which opens the settings on the
cluster. The phone sheet's network row SHALL carry the same two buttons
while the cluster does not answer.

#### Scenario: A cluster that stops answering

- **WHEN** the cluster stops answering
- **THEN** the network indicator's dot is the warning colour, it reads
  "<Name> · Not responding", and a click opens a panel with "Try again" and
  "Change network"; "Change network" opens the settings on the cluster

#### Scenario: Try again on the network panel (manual)

- **WHEN** a user whose custom cluster does not answer presses "Try again"
  on the network panel, and the cluster answers
- **THEN** the button reads "Trying…" until the cluster answers, and the
  indicator then reads the cluster's name

### Requirement: The AI indicator

The AI indicator SHALL be ready while a model is connected and usable, show
the model's name and be named "AI, ready" (not the model's name, which the
composer's model button is named by). With no model connected,
or the default backend while nobody is signed in, it SHALL be idle (grey
dot), read "AI · Off" and be named "AI, off": no model is the user's choice,
not a failure. While no model is connected and the app is still asking the
deployment whether it serves a hosted model, it SHALL be working, read "AI ·
Checking" and be named "AI, checking". While no model is connected, the
browser is online and that asking failed (no answer, an error status or a
bad body), it SHALL be failed (red dot), read "AI · Not responding" and be
named "AI, not responding"; a click SHALL open a panel titled "AI" with the
line "The hosted model is not responding. Try again, or add a key of your
own.", "Try again", which asks again and, when it still fails, says "Could
not reach the hosted model.", and "Add an API key". After the hosted model
refused a turn
because the free daily limit is used (its daily cap or its spent pool), it
SHALL be waiting (warning dot), read "AI · Limit reached" and be named "AI,
limit reached", until the next 00:00 UTC, until another backend is
connected, or until the backend is forgotten. A click SHALL open Connect a
model, except at Not responding (above) and at Limit reached, where it SHALL
open a panel titled "AI" with "AI · Limit reached", the line "The free daily
limit is used. It comes back at <HH:MM>, or add a key of your own to keep
going." (the next 00:00 UTC in the user's own clock) and the button "Add an
API key", which opens Connect a model.

#### Scenario: No model connected

- **WHEN** a signed-out user with no model connected opens the app
- **THEN** the AI indicator reads "AI · Off" with a grey dot, and a click
  opens Connect a model

#### Scenario: The AI indicator while the app checks (manual)

- **WHEN** a user with no model connected opens the app and the hosted
  model's check has not answered yet
- **THEN** the AI indicator reads "AI · Checking" with the working dot

#### Scenario: The free daily limit is used

- **WHEN** a signed-in user on the hosted model sends a turn the hosted
  model refuses under its daily cap
- **THEN** the AI indicator reads "AI · Limit reached" with the warning dot;
  a click opens a panel saying when the limit comes back, with "Add an API
  key", which opens Connect a model

#### Scenario: The hosted model does not answer

- **WHEN** a user with no model connected opens the app while the hosted
  model's check fails with a server error
- **THEN** the AI indicator reads "AI · Not responding" with a red dot, and
  its panel offers "Try again" and "Add an API key"

### Requirement: The phone folds status into one chip

Below 768 px the work page's bar SHALL show one status chip with the worst
state: "Offline" while the browser reports no connection, "<n> not ready"
when any indicator is waiting or failed (idle ones are not counted), red only
when one has failed, "Starting" when one is working and none is waiting or
failed, "Ready" otherwise, named "Status, <words>". Beside a project name the
chip SHALL give way first: the name keeps at least 6 characters and the chip
folds to its dot. A tap SHALL open a sheet titled "Status" with one row per
indicator: its dot, name and state words, what it means when not ready, and
its actions ("Try again" and "Change network" for a cluster that does not
answer, "Try again" and "Add an API key" for a hosted model that does not,
"Change network", "Connect a model", "Add an API key", "Reload").
The chip, each row's action and the sheet's close SHALL be at least 44 px
tall.

#### Scenario: The phone chip names what is down

- **WHEN** a user on a 390 px wide screen with no model connected, whose
  cluster does not answer, taps the status chip
- **THEN** the chip reads "1 not ready" (the cluster; the AI off is not
  counted), and the sheet lists Network, AI and Rust analyzer, with "Try
  again" and "Change network" on the Network row, and "AI · Off" and
  "Connect a model" on the AI row

#### Scenario: The phone chip reads Offline

- **WHEN** a user on a 390 px wide screen goes offline
- **THEN** the chip reads "Offline" and is named "Status, offline"

### Requirement: Status events

The slice SHALL send `status_indicator_picked` each time a user clicks an
indicator or a sheet row's action, with `indicator` (`network`, `ai`, `rust`),
`state` (`ready`, `working`, `not-ready`; a failure is sent as `not-ready` and
an idle indicator as `ready`) and `from` (`row`, `rail`, `sheet`); and
`status_sheet_opened` each time the phone's sheet opens, with `worst`
(`ready`, `working`, `not-ready`). It SHALL send `status_retried` each time
a user's "Try again" on an indicator's panel or sheet row finishes asking,
with `indicator` (`network`, `ai`), `from` (`row`, `rail`, `sheet`) and
`answered` (`true` when the cluster, or the hosted model, answered; `false`
otherwise). Connect a
model opened from the AI indicator SHALL send the assistant's
`assistant_connect_opened` with `via: "status"`. The stage notice SHALL send
`status_notice_shown` once each time a notice appears, with `notice`
(`offline`, `cluster-down`); `status_notice_dismissed` each time a user
presses its Dismiss, with `notice` (`offline`, `cluster-down`); and
`status_notice_action` each time a user presses one of its actions, with
`notice` (`cluster-down`) and `action` (`retry`, `change-network`).

#### Scenario: Picking an indicator is measured

- **WHEN** a user clicks the AI indicator in the status row while no model
  is connected
- **THEN** `status_indicator_picked` is sent with `indicator: "ai"`,
  `state: "ready"`, `from: "row"`

#### Scenario: A notice is measured once per onset

- **WHEN** the browser goes offline on the Build stage and the user switches
  to Deploy and back
- **THEN** `status_notice_shown` is sent once, with `notice: "offline"`

#### Scenario: Dismissing a notice is measured (manual)

- **WHEN** a user presses Dismiss on the offline notice
- **THEN** `status_notice_dismissed` is sent with `notice: "offline"`

#### Scenario: Try again is measured (manual)

- **WHEN** a user presses "Try again" on the network panel in the status row
  and the cluster still does not answer
- **THEN** `status_retried` is sent with `indicator: "network"`,
  `from: "row"`, `answered: false`
