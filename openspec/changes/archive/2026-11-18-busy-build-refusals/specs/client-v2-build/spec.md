# Spec Delta

## ADDED Requirements

### Requirement: A build turned away as busy is counted as busy

When the build server's answer is a `429` or `503` that carries
`Retry-After`, the `build` command SHALL send, through the
`features/program-build` tracker, `build_failed { framework, reason: "busy" }`
in place of `reason: "server"`. `reason` thus takes one of `compile`,
`network`, `server` or `busy`. `build_started` SHALL be sent as before, and
no other event is added or renamed.

#### Scenario: A build turned away by a build limit (manual)

- **WHEN** an Anchor project's build is answered `429` with `Retry-After`
- **THEN** the memory provider records `build_started` with
  `{ framework: "anchor" }`, then `build_failed` with
  `{ framework: "anchor", reason: "busy" }`

#### Scenario: A 503 without Retry-After (manual)

- **WHEN** a build is answered `503` without `Retry-After`
- **THEN** the memory provider records `build_failed` with
  `reason: "server"`
