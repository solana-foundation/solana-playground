# Spec Delta

## Purpose

**Area:** the consent banner and the Settings "Analytics" switch (client-v2 UI)

When Playground may load Google Analytics and send it events, how a visitor is
asked, and how the answer is changed and kept, so analytics runs only for
visitors who allowed it.

## ADDED Requirements

### Requirement: A visitor's analytics choice has three states

A browser's analytics choice SHALL be one of `unanswered`, `allowed` or
`declined`, kept in this browser's `localStorage` under one key. A value that
is missing, unreadable or not one of the three SHALL read as `unanswered`.
Storage that throws SHALL read as `unanswered` and SHALL NOT break the page.

#### Scenario: A fresh browser
- **WHEN** a visitor opens Playground for the first time
- **THEN** the choice reads `unanswered`

#### Scenario: Storage is blocked (manual)
Pinned by the in-source blocks of `client-v2/src/shared/lib/telemetry/consent.ts` and `providers/ga4.ts`, under `yarn test-unit`.
- **WHEN** the browser throws on every `localStorage` access
- **THEN** the page renders, the choice reads `unanswered`, and GA4 does not load

### Requirement: GA4 runs only while the choice is allowed

With a measurement id set, GA4 SHALL load `gtag.js` and receive events only
while the choice is `allowed`. While it is `unanswered` or `declined`, no
request SHALL go to `googletagmanager.com` or `google-analytics.com`, and no
gtag queue SHALL exist on `window`.

#### Scenario: A visitor who declines
- **WHEN** a visitor presses Decline on the banner and then builds and deploys a program
- **THEN** no request goes to `googletagmanager.com` during the visit

#### Scenario: A visitor who allows
- **WHEN** a visitor with a measurement id configured presses Allow on the banner
- **THEN** `gtag.js` loads once and the next tracked event reaches `gtag`

### Requirement: Events before consent never reach GA4

An event tracked while the choice is `unanswered` or `declined` SHALL NOT be
sent to GA4, then or after a later Allow. Events tracked after Allow SHALL be
sent.

#### Scenario: Allowing after some use
- **WHEN** a visitor tracks `dply_started`, then presses Allow, then tracks `dply_succeeded`
- **THEN** GA4 receives `dply_succeeded` and never `dply_started`

### Requirement: A banner asks once

While the choice is `unanswered` in a build with a measurement id, a banner (`role` "region", `aria-label`
"Analytics consent") SHALL show at the foot of the window with the line
"Playground uses Google Analytics to see which features people use. Allow
it?", a "Privacy policy" link to `https://solana.com/privacy-policy` that
opens in a new tab, and the buttons "Decline" and "Allow".

#### Scenario: The banner on a fresh browser
- **WHEN** a visitor opens Playground with no stored choice
- **THEN** the banner shows with Decline, Allow and the Privacy policy link

### Requirement: An answer closes the banner for good

Either button SHALL store the choice and close the banner. The banner SHALL NOT
show again in that browser while a choice is stored.

#### Scenario: The banner after an answer
- **WHEN** a visitor presses Decline and reloads the page
- **THEN** no banner shows

### Requirement: Settings change the choice

The Settings page SHALL hold an "Analytics" switch in the Advanced section,
with the help line "Send usage events to Google Analytics." It SHALL read on
for `allowed` and off for `unanswered` or `declined`. Turning it on SHALL
store `allowed` and load GA4 without a reload. Turning it off SHALL store
`declined`, stop sending events at once, and remove GA4's cookies on the app's
domain.

#### Scenario: Turning analytics off
- **WHEN** a visitor who allowed analytics turns the Analytics switch off
- **THEN** the choice reads `declined`, no further event reaches `gtag`, and no `_ga` cookie remains on the app's domain

#### Scenario: Turning analytics on from Settings
- **WHEN** a visitor who declined turns the Analytics switch on
- **THEN** the choice reads `allowed` and `gtag.js` loads without a reload

### Requirement: The analytics choice is tracked

`widgets/observability` SHALL emit `obs_analytics_consent_set` each time a
choice is stored, with `choice` (`allowed`, `declined`) and `via` (`banner`,
`settings`). The event SHALL be tracked after the choice is stored, so an
`allowed` choice reaches GA4 and a `declined` choice reaches only the log
provider.

#### Scenario: Declining on the banner
- **WHEN** a visitor presses Decline on the banner
- **THEN** `obs_analytics_consent_set` with `choice: "declined"` and `via: "banner"` is tracked, and GA4 does not receive it
