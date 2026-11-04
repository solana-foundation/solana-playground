# Spec Delta

## Purpose

How a slice of `client-v2` declares and emits product events, which names and
parameters are allowed, and when an event leaves the browser, so that every
feature and widget can be measured the same way.

## ADDED Requirements

### Requirement: Every slice with browser code declares its events

A slice under `features/` or `widgets/` that has an `index.ts` SHALL have
`model/telemetry.ts`, which SHALL export a tracker created with
`createTracker` from `shared/lib/telemetry`.

#### Scenario: A slice without a telemetry file

- **WHEN** a directory `features/<a>` or `widgets/<a>` contains `index.ts`
  and no `model/telemetry.ts`
- **THEN** the slice-structure unit test fails and names the slice

#### Scenario: A slice with server code only

- **WHEN** a slice has `server.mjs` and no `index.ts`
- **THEN** the slice-structure test does not require `model/telemetry.ts`

### Requirement: Every event is described

Every key of an event map passed to `createTracker` SHALL have a TSDoc
comment that says what the event means and when it fires, and every change
under `openspec/changes/` that adds or renames an event SHALL describe it in
a requirement of its slice's spec: the name, when it fires, and each
parameter with its allowed values.

#### Scenario: An event without a doc comment

- **WHEN** a key of the event map in `model/telemetry.ts` has no TSDoc
  comment
- **THEN** the slice-structure unit test fails and names the slice and the
  event

#### Scenario: A change adds an event

- **WHEN** a change proposal adds an event to a slice
- **THEN** its proposal lists the event under What Changes and its spec delta
  has a requirement describing it; a reviewer rejects the change otherwise

#### Scenario: A change touches a slice without changing its events

- **WHEN** a change proposal modifies a slice and adds, renames, and removes
  no event
- **THEN** its proposal says so under What Changes

### Requirement: Event names are checked at compile time

Every key of an event map passed to `createTracker` SHALL be a string literal
of at most 40 UTF-16 code units that starts with a prefix registered in
`shared/lib/telemetry/prefixes.ts` followed by `_`, and `track` SHALL accept
only a key of the tracker's map with that key's parameter type.

#### Scenario: A name over the GA4 limit

- **WHEN** an event map has a key of 41 characters
- **THEN** `yarn test-types` fails at the `createTracker` call

#### Scenario: A name at the limit

- **WHEN** an event map has a key of exactly 40 characters
- **THEN** `yarn test-types` passes

#### Scenario: A map with a wide key type

- **WHEN** `createTracker` is given `Record<string, ...>`
- **THEN** `yarn test-types` fails at the `createTracker` call

#### Scenario: An unregistered prefix

- **WHEN** an event map has a key whose prefix is not in `prefixes.ts`
- **THEN** `yarn test-types` fails at the `createTracker` call

#### Scenario: A misspelt name or wrong parameter at a call site

- **WHEN** `track` is called with a name not in the map, or with a parameter
  missing or of the wrong type
- **THEN** `yarn test-types` fails at that call

### Requirement: Prefixes are unique

Each slice SHALL have one prefix in `prefixes.ts`, and no two slices SHALL
share a prefix.

#### Scenario: Two slices register the same prefix

- **WHEN** two entries in `prefixes.ts` have the same value
- **THEN** the prefix unit test fails and names both slices

### Requirement: Event parameters are primitives that identify no one

Event parameters SHALL be `string`, `number`, or `boolean`, and SHALL NOT
contain a wallet address, a transaction signature, a program id the user
deployed, a file name, file content, or an error message that can contain
user input.

#### Scenario: A failure is tracked

- **WHEN** a slice tracks a failure
- **THEN** the event carries an enumerated reason, not the error message, and
  a unit test with the memory provider asserts the exact parameters

#### Scenario: An object is passed as a parameter

- **WHEN** a parameter's type is an object or array
- **THEN** `yarn test-types` fails

### Requirement: A widget attributes events without props

An event tracked through `useTracker` SHALL carry the name of the nearest
enclosing `TelemetryScope`, including when the emitting component renders in
a portal.

#### Scenario: An event from a dialog inside a widget

- **WHEN** a component in a Radix dialog opened from inside
  `<TelemetryScope name="deploy-panel">` tracks an event
- **THEN** the memory provider records the event with scope `deploy-panel`

#### Scenario: An event from code outside React

- **WHEN** a module under `model/` calls `tracker.track` without a scope
- **THEN** the event is recorded with no scope, and nothing throws

### Requirement: Events are delivered once telemetry is initialised

Events SHALL reach providers after `initTelemetry`. Events tracked before
`initTelemetry` SHALL be buffered up to a fixed bound and delivered once it
runs.

#### Scenario: An event before initialisation

- **WHEN** an event is tracked before `initTelemetry`, and `initTelemetry` is
  then called
- **THEN** the provider receives the buffered event once

### Requirement: GA4 loads only with a measurement id

The GA4 provider SHALL send nothing without a measurement id, and with one
SHALL queue events from its creation, so events tracked before `gtag.js`
loads are sent once it does. `GoogleAnalytics` SHALL inject `gtag.js` once
when a measurement id is set, and nothing when it is unset.

#### Scenario: An event before gtag.js loads

- **WHEN** an event is tracked after `initTelemetry` and before `gtag.js` has
  loaded, with a measurement id set
- **THEN** the event is in the queue `gtag.js` reads when it loads

#### Scenario: No measurement id

- **WHEN** a build without `REACT_APP_GA_MEASUREMENT_ID` tracks an event
- **THEN** no request goes to Google and nothing throws

#### Scenario: A measurement id is set

- **WHEN** a build with `REACT_APP_GA_MEASUREMENT_ID` tracks `dply_started`
- **THEN** `gtag` is called with event `dply_started` and its parameters

#### Scenario: Rendering on the server or in a test without initialisation

- **WHEN** `track` runs where `window` is undefined
- **THEN** nothing throws and nothing is sent
