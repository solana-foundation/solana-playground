# Spec Delta

## Purpose

What the production build of `client-v2` must produce and within which limits,
so that it completes on the standard deploy machine and its output behaves as
the development build does.

## ADDED Requirements

### Requirement: The production build fits in 8 GB of memory

A cold production build SHALL complete with a peak memory use below 8 GB,
summed over every process the build starts, with the `NODE_OPTIONS` the
deployment sets.

#### Scenario: A cold build on the standard deploy machine (manual)

- **WHEN** a preview deployment builds the branch without a build cache on
  Vercel's standard build machine
- **THEN** the build completes, and the build log reports no "Out of Memory"
  event

#### Scenario: A cold build measured locally (manual)

- **WHEN** the production build runs with an empty `node_modules/.cache` and
  the deployment's `NODE_OPTIONS`, and the summed memory of its processes is
  sampled
- **THEN** the peak is below 8 GB

### Requirement: Minification keeps the names of `_Pg` classes

The minified production bundle SHALL keep the name of every class and function
whose name starts with `_Pg`, because change events are named after it. CI
SHALL fail when the built bundle lacks one of those names.

#### Scenario: The bundle carries the decorator class names (manual)

- **WHEN** CI builds the production bundle
- **THEN** a CI step finds `_PgConnection` and `_PgProgramInfo` as names in
  the built JavaScript, and fails the run when either is missing

#### Scenario: Dependent change events in the production build (manual)

- **WHEN** the production build is served and the connection's endpoint is
  changed in settings from Devnet to Testnet
- **THEN** the cluster label in the bottom bar changes to Testnet, and the tab
  does not freeze in a loop of change events

### Requirement: Minified output stays within the production browser floor

The minifier SHALL emit no syntax newer than the production `browserslist`
allows, and SHALL take its target from that list, not from a list of its own.

#### Scenario: The floor changes (manual)

- **WHEN** a reviewer reads the build configuration after the production
  `browserslist` is raised
- **THEN** the minifier's target follows it with no second edit

#### Scenario: A browser at the floor (manual)

- **WHEN** the production build is opened in the oldest Safari the production
  `browserslist` allows
- **THEN** every JavaScript chunk loads without a syntax error in the console

### Requirement: Type checking and linting gate the merge, not the build

The production build SHALL NOT run the type check or ESLint. CI SHALL run both
on every pull request, `yarn run check` SHALL run both, and the development server
SHALL keep reporting type errors in its overlay.

#### Scenario: A type error in a pull request (manual)

- **WHEN** a pull request adds a type error
- **THEN** the production build still completes, and the `test-types` step in
  CI fails the pull request

#### Scenario: A type error before a push (manual)

- **WHEN** a developer with the pre-push hook enabled pushes a commit with a
  type error
- **THEN** `yarn run check` fails and the push stops

#### Scenario: A type error in development (manual)

- **WHEN** the development server is running and a file gains a type error
- **THEN** the overlay shows the error
