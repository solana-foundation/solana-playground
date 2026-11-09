# Spec Delta

## Purpose

What the product reports when a program is built, so the funnel can count
builds that succeed and tell a compile error from a build server that
failed.

Every scenario is marked `(manual)`: events leave the browser only through
GA4, which no Playwright test reads. A unit test through the memory provider
holds each one, and each can be checked in GA4's DebugView.

## ADDED Requirements

### Requirement: Build events

The `build` command (`commands/build/build.ts`) SHALL send, through the
`features/program-build` tracker, `build_started { framework }` once its files
are gathered (Seahorse compiles them in the browser before they go to the
build server), `build_succeeded { framework, has_idl }`
when the compiler reports no error, and `build_failed { framework, reason }`
when it does, or when the build server refuses or does not answer.
`framework` is `anchor`, `seahorse` (Python sources) or `native` (any other
Rust program); `has_idl` is a boolean; `reason` is `compile` (the compiler, or
Seahorse's compiler, reported an error), `network` (the build server did not
answer) or `server` (anything else: a refusal, or a build that could not run).
A stopped build sends no outcome, and an empty program file, which is never
sent, sends nothing. The Build stage, the terminal, the assistant and a
tutorial all run this command, so each build is counted once whatever started
it. No event carries file names, the program id or compiler output.

#### Scenario: A compile error is tracked (manual)

- **WHEN** a build of an Anchor project fails with a compiler error
- **THEN** the memory provider records `build_started` with
  `{ framework: "anchor" }`, then `build_failed` with
  `{ framework: "anchor", reason: "compile" }`

#### Scenario: A build server that does not answer (manual)

- **WHEN** the build request gets no answer
- **THEN** the memory provider records `build_failed` with
  `reason: "network"`

#### Scenario: A stopped build (manual)

- **WHEN** the user stops a build in flight
- **THEN** the memory provider records `build_started` and no outcome
