# Spec Delta

## Purpose

What the Build, Deploy and Interact stages of the development loop show: a
failed build explained line by line, the latest deployment's program id, what
Interact still needs before it can call the program, and the stage's one
action within reach of the thumb on a phone.

## ADDED Requirements

### Requirement: The Build stage explains a failed build

The Build stage SHALL show each compiler error as a diagnostic
(`data-slot="diagnostic"`) with its error code, a plain explanation and the
source lines around it, the faulty line marked (`data-fault`) with the
compiler's label, and SHALL offer Explain and Fix on it, each sending the
error to the assistant. Every diagnostic's Explain and Fix SHALL be the same
outline buttons: no card's action stands out as the screen's brand action.
The stage keeps `flow-stage-panel-build`.

#### Scenario: A failed build marks the faulty line

- **WHEN** a build fails with a type error in `src/lib.rs` line 5
- **THEN** the stage shows one diagnostic with the code E0308
- **AND** line 5 is marked as the faulty one, with "expected u32, found &str"
  beside it
- **AND** Explain and Fix are offered on it

### Requirement: Build refuses an empty program file

When `src/lib.rs` exists and holds nothing but whitespace, Build SHALL send no
build request, SHALL name the file as empty with "Write a program, or ask the
assistant for one.", and SHALL count the attempt as a failed build, so Deploy
does not go on with the binary of the program the file used to hold. A
project without `src/lib.rs` builds as before.

#### Scenario: Building an empty lib.rs (manual)

- **WHEN** a user empties `src/lib.rs` in a project that built before and
  presses Build
- **THEN** no request reaches the build server, the terminal and the Build
  stage say "lib.rs is empty. Write a program, or ask the assistant for one."
- **AND** Deploy then warns "The last build failed" and asks before it
  uploads the earlier binary

### Requirement: A slow build says so

While a build runs, the Build stage SHALL keep a polite status region, and
SHALL put "This build is taking longer than usual. The server may be busy. It keeps running." in it once the run has
lasted 60 seconds, counted from the run's own start so a remount does not
restart the clock. The line is never in a warning colour. A first build, on
the "Nothing built yet" surface, leaves the region empty: it says it is slow
in the words of `client-v2-first-run`, and the stage never shows both lines.

#### Scenario: A build past 60 seconds (manual)

- **WHEN** a build has run for more than 60 seconds, the Build stage
  remounting once on the way
- **THEN** the stage shows "This build is taking longer than usual. The server may be busy. It keeps running." in muted
  text under the build's progress, and a screen reader announces it once
- **AND** the line is gone when the build ends

#### Scenario: A first build past 60 seconds (manual)

- **WHEN** the first build of a project has run for more than 60 seconds
- **THEN** the stage shows "First builds take longer. This one is running."
  and not "This build is taking longer than usual. The server may be busy. It keeps running."

### Requirement: The Deploy stage shows the latest deployment

After a deployment the Deploy stage SHALL show, in a `role="status"` block,
where it was deployed and the program id with a button that copies it
(`data-slot="copy-button"`). The stage keeps `flow-stage-panel-deploy`.

#### Scenario: A deployment shows its program id to copy

- **WHEN** the project has been deployed to devnet
- **THEN** the Deploy stage says "Deployed to devnet"
- **AND** shows the program id with a button that copies it

### Requirement: The Interact stage says what is missing

Until the program can be called, the Interact stage SHALL say in one empty
state (`data-slot="stage-empty"`) what is missing and offer the step that
supplies it: Go to Build before a build or without a program id, Go to Deploy
before a deployment,
Load IDL file for an imported program without an IDL. The stage keeps
`flow-stage-panel-interact`.

#### Scenario: Interact before a deploy

- **WHEN** a built project that has never been deployed opens the Interact
  stage
- **THEN** the stage says "Nothing to call yet"
- **AND** offers Go to Deploy, which switches to the Deploy stage

### Requirement: A stage's action sits at the foot on a phone

Below 768 px the action row of the Build, Deploy and Interact stages
(`data-slot="stage-empty-actions"`) SHALL sit at the foot of the stage,
whether the stage's content is shorter or taller than the screen.

#### Scenario: The Build action at the foot on a phone

- **WHEN** the Build stage is shown on a 390 px wide screen with nothing built
- **THEN** the Build button sits at the foot of the stage

#### Scenario: The Deploy action at the foot on a phone

- **WHEN** the Deploy stage of a deployed project is shown on a 390 px wide
  screen
- **THEN** the Redeploy button sits at the foot of the stage

#### Scenario: The Interact action at the foot on a phone

- **WHEN** the Interact stage of a project that has never been deployed is
  shown on a 390 px wide screen
- **THEN** the Go to Deploy button sits at the foot of the stage

### Requirement: A stage whose code did not load says so in its panel

Build, Deploy and Interact load their code on demand. When that code does not
arrive, the stage's own panel SHALL show the failure while the tabs and the
editor stay up, and SHALL say the user's code is unchanged. Online the title
SHALL read "<Stage> couldn't load" with Try again and Reload page; offline it
SHALL read "<Stage> needs a connection" with Try again alone, since a reload
offline would lose the app. Online, a Try again that fails too SHALL point the
user to Reload page. A stage that failed offline SHALL load again by itself when the
network returns. A failure with a network SHALL be reported to production
monitoring once per stage per page load; a failure offline, a retry the
returning network started, and a repeat SHALL only be logged.

#### Scenario: The code does not arrive with a network

- **WHEN** the user opens Deploy online and its code fails to load
- **THEN** the panel reads "Deploy couldn't load" with Try again and Reload
  page, and the failure is reported once

#### Scenario: Try again fails too

- **WHEN** the user, online, presses Try again and the load fails again
- **THEN** the panel tells the user to reload the page, and nothing more is
  reported

#### Scenario: Offline, then the network returns

- **WHEN** the user opens Build offline and its code fails to load
- **THEN** the panel reads "Build needs a connection" with Try again only, and
  nothing is reported
- **WHEN** the network returns
- **THEN** the stage loads again without a press
