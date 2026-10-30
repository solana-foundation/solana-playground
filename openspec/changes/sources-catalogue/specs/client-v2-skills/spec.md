# Spec Delta

## Purpose

The skills slice of client-v2: the skills it lists from the server and loads for the assistant, and the event
it reports when a user switches one.

## ADDED Requirements

### Requirement: The slice lists the server's skills

The slice SHALL fetch `GET /api/skills` and return its skills as entries the assistant can load, each with the
`enabled` value the server lists: a bundled
skill's content comes from the bundle by its id, a remote skill's from its listed `baseUrl` and `entry`. A
listed bundled id the bundle does not know SHALL be left out and logged. A failed fetch SHALL reject, logged
through the slice's logger, and SHALL NOT fall back to a built-in list.

#### Scenario: The server lists both Foundation skills (manual)

- **WHEN** `GET /api/skills` lists `playground-env` as bundled and `solana-dev` as remote
- **THEN** the slice returns both entries, and loading `playground-env` needs no network request

#### Scenario: A community skill listed off (manual)

- **WHEN** `GET /api/skills` lists a community skill as remote with `enabled: false`
- **THEN** the slice returns it with `enabled: false`, and `enabledSkillIds` does not hold its id until the user
  checks it

#### Scenario: A bundled id the bundle does not know (manual)

- **WHEN** `GET /api/skills` lists a bundled skill `other`
- **THEN** the slice returns the other entries without `other` and logs a warning naming `other`

### Requirement: A reference path stays inside its skill

`read_skill_reference` SHALL resolve a path against the skill's `baseUrl` and SHALL reject a path that leaves
that folder. A bundled skill SHALL have no reference files.

#### Scenario: A path that climbs out (manual)

- **WHEN** the model reads `../other/SKILL.md` from `solana-dev`
- **THEN** the tool returns an error string and sends no request

### Requirement: Switching a skill is reported

The event `skills_toggled` SHALL fire each time a user checks or unchecks a skill in the Sources tab, with `id`:
the skill's id as the catalogue names it, and `enabled`: `true` when the skill was switched on, `false` when off.
No event of the slice SHALL carry a skill's content or a URL.

#### Scenario: A skill unchecked (manual)

- **WHEN** the user unchecks `solana-dev`
- **THEN** `skills_toggled` fires once with `id: "solana-dev"` and `enabled: false`
