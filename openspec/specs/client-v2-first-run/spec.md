# client-v2-first-run Specification

## Purpose
Gets a first-time visitor from Home to a running example in one press, a returning visitor back to recent work in one press, and keeps a slow first build from reading as broken.

## Requirements

### Requirement: Home offers the example on a first visit
Desktop Home SHALL show a section labelled "Try an example" above its three tiles when the browser holds no project, the session has answered, and either nobody is signed in or the signed-in account's own project list has come back empty, with the line "This program saves a number in an account and writes it to the logs." and a button "Run it" that comes before the composer in tab order. It SHALL NOT show when any project exists, or while the session is unread or its read failed (no answer within 10 s, a 5xx, a 4xx other than 401 or 404, or JSON that does not parse), since that says nothing of who is signed in. A deployment with no sign-in configured answers with a 503 that says so, and a host with no auth route answers a page or a 404; these are answers, except while a user is already known, when a page or a 404 is a proxy's and fails (nobody is signed in), not failures. Once a read has answered, a later failed one does not take the example away.

#### Scenario: First visit on desktop
- **WHEN** Home opens in a browser with no project
- **THEN** a region named "Try an example" with a "Run it" button shows above the "New project" tile

#### Scenario: Signed in with no projects (manual)
- **WHEN** Home opens with no project for a signed-in account whose project list has come back empty
- **THEN** the "Try an example" region shows

#### Scenario: Signed in, account list not read yet (manual)
- **WHEN** Home opens with no project for a signed-in account whose project list sync has not read yet
- **THEN** neither "Try an example" nor "Pick up where you left off" shows until it has

#### Scenario: Session read failed
- **WHEN** Home opens with no project and the session read got no answer or a 5xx
- **THEN** no "Try an example" region shows until a re-read answers

#### Scenario: Failed check retried (manual)
- **WHEN** Home opens with no project, the session read fails, and the check keeps failing
- **THEN** it re-reads on a timer that backs off (2, 4, 8, 16, 32 s) and sooner on each focus or return online (none while offline), five reads in all; no "Try an example" region shows; after the fifth Home shows "We could not check your account." with a "Try again" button, which re-reads it, counts `home_session_retried` and stays until a read answers

#### Scenario: Sign-in not configured
- **WHEN** Home opens with no project on a deployment whose auth route answers "Authentication is not configured"
- **THEN** the "Try an example" region shows

#### Scenario: Return visit on desktop
- **WHEN** Home opens in a browser holding a project
- **THEN** no "Try an example" region shows

### Requirement: Run it builds the example once
"Run it" SHALL create the project `anchor-example` from the Anchor starter, open it and start one build without another press. When a project named `anchor-example` already exists it SHALL open that project and start no build. Nothing else, a reload included, SHALL start a build on its own.

#### Scenario: First press
- **WHEN** "Run it" is pressed with no `anchor-example` project
- **THEN** the project `anchor-example` is created and opened, and one build starts

#### Scenario: The example exists (manual)
- **WHEN** "Run it" is pressed while `anchor-example` exists
- **THEN** that project opens, no second copy is made and no build starts

### Requirement: Home lists recent work on a return visit
Desktop Home SHALL show a section labelled "Pick up where you left off" above its tiles when the browser holds a project, listing at most three: the open project first, then the rest latest added to this browser first. A press SHALL open the entry; a started tutorial opens at its page, and the open project returns to the work under Home.

#### Scenario: Three of five (manual)
- **WHEN** Home opens with five projects, `b` open
- **THEN** "Pick up where you left off" lists three entries, `b` first

#### Scenario: Opening an entry (manual)
- **WHEN** an entry other than the open project is pressed
- **THEN** that project or tutorial opens

### Requirement: Phone Home starts with the example on a first visit
Phone Home SHALL offer "Try an example" as its first quick start when the browser holds no project and the visit is a first one as above, opening it as "Run it" does; with a project open, "Continue {project}" SHALL stay first. It SHALL show at most three quick starts.

#### Scenario: Phone, first visit
- **WHEN** phone Home opens with no project
- **THEN** the first quick start is "Try an example", followed by "New Anchor project" and the first Beginner tutorial

### Requirement: A slow first build says so
While a build runs on the Build stage's "Nothing built yet" surface, the surface SHALL show the seconds since the build started, and from 60 s on it SHALL add the line "First builds take longer. This one is running." while the build goes on.

#### Scenario: Past a minute
- **WHEN** the first build has run for 61 seconds
- **THEN** the Build stage shows "61 s" and "First builds take longer. This one is running."

#### Scenario: Under a minute (manual)
- **WHEN** the first build has run for 12 seconds
- **THEN** the Build stage shows "12 s" and not the slow-build line

### Requirement: Home counts the first run and recent work
The `home` slice SHALL emit `home_example_run` with `outcome` `created`, `opened` or `current` (the example was already open) when "Run it" or the phone's example quick start succeeds, and `home_recent_opened` with `kind` `project`, `tutorial` or `current` when a "Pick up where you left off" entry opens. `home_quickstart_opened` SHALL accept the id `example`, and `home_session_retried` SHALL be emitted when "Try again" is pressed after the account check kept failing.

#### Scenario: Example created (manual)
- **WHEN** "Run it" creates the example
- **THEN** `home_example_run` is tracked once with `outcome: "created"`

#### Scenario: Example current (manual)
- **WHEN** "Run it" is pressed while the example is already the open project
- **THEN** the work under Home shows again and `home_example_run` is tracked with `outcome: "current"`

#### Scenario: Recent tutorial (manual)
- **WHEN** a started tutorial is opened from "Pick up where you left off"
- **THEN** `home_recent_opened` is tracked with `kind: "tutorial"`
