## ADDED Requirements

### Requirement: An act names the account it shows

A `run` or `call` act MAY carry `account`: a `player` view (`name`, `energy`, `wood`, `max`, optional `refill: { seconds, from }`) or a `memory` view (`name`, `capacity`, optional `zero`). `yarn tutorial:check` SHALL refuse `account` on any other act.

#### Scenario: An account on a build

- **WHEN** a `build` act carries `account`
- **THEN** the check fails naming that act's path

#### Scenario: A chop act with a player view

- **WHEN** a `call` act names `{ "kind": "player", "name": "player", "energy": "energy", "wood": "wood", "max": 5 }`
- **THEN** the check passes
