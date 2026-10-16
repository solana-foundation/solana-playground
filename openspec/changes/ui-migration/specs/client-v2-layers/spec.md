# Spec Delta

## Purpose

Where new frontend code in `client-v2` lives, what it may import, and how a
component of ours is split, so that several people and agents place code the
same way without asking.

## ADDED Requirements

### Requirement: New code sits in five layers

New code under `client-v2/src` SHALL live in one of `app/`, `widgets/`,
`features/`, `entities/`, `shared/`, and a module SHALL import only from
layers below its own in the order `app -> widgets -> features -> entities -> shared`.

#### Scenario: A feature imports another feature

- **WHEN** a module under `features/<a>` imports from `features/<b>`
- **THEN** the import is a violation, and the two features are composed in a
  module under `widgets/` that imports both

#### Scenario: An entity imports another entity

- **WHEN** a module under `entities/<a>` imports from `entities/<b>`
- **THEN** the import is a violation; cross-imports between entities are not
  enabled

#### Scenario: The one standing exception, auth and persistence

- **WHEN** `features/auth` imports `features/persistence` (its server module
  uses the pool) or `features/persistence` imports `features/auth` (it reads
  the session)
- **THEN** the import is tolerated as the named exception until the cycle is
  broken (`ui-migration` task 1.4), and the boundary check exempts exactly
  these two

#### Scenario: A new screen-level composition is needed

- **WHEN** a new arrangement of panels or bars is built
- **THEN** it lives under `widgets/`; there is no `pages/` layer

### Requirement: A slice is entered through its door

A slice SHALL expose `index.ts` for browser code and, when it has routes,
`server.mjs` for `api/` routes, and other modules SHALL import the slice only
through those files.

#### Scenario: Deep import into a slice

- **WHEN** a module imports `features/<a>/model/<file>` directly
- **THEN** the import is a violation and is rewritten to `features/<a>`

### Requirement: The legacy roots are outside the layers

The pre-existing roots SHALL be treated as legacy: importable from new code,
exempt from the boundary check, and closed to new UI. They are `components/`,
`views/`, `utils/`, `hooks/`, `providers/`, `commands/`, `effects/`,
`routes/`, `settings/`, `themes/`, `frameworks/`, `languages/`,
`tutorials/`, `block-explorers/`, `constants/`, `globals/`, `types/`.

#### Scenario: New code uses a legacy helper

- **WHEN** a module in a layer imports from `utils/` or `components/`
- **THEN** the import is allowed

#### Scenario: New UI is added to a legacy root

- **WHEN** a new React component is created under `views/` or `components/`
- **THEN** that is a violation; it belongs in a layer

### Requirement: Our components come in pairs

A component of ours SHALL exist as `Base<Name>`, built from design-system
parts and taking everything through props, and `<Name>`, which wraps the Base
and connects the data. Design-system components SHALL keep their shadcn names
without the prefix, and SHALL be installed rather than rewritten when the
design system has them.

#### Scenario: Rendering a Base in isolation

- **WHEN** `Base<Name>` is rendered with props only, outside the app
- **THEN** it renders completely, with no store, explorer or network

#### Scenario: The design system already has the component

- **WHEN** a needed component exists in the design system
- **THEN** it is installed into `shared/ui`, not rebuilt as a Base

### Requirement: Installed components are not edited by hand

Files under `shared/ui` SHALL be installed from the design system and SHALL
NOT be edited in place; a change is made in the design system and
reinstalled.

#### Scenario: A shared component needs a change

- **WHEN** a design-system component in `shared/ui` must look or behave
  differently
- **THEN** the change is made in `design-system/` and the component is
  reinstalled, overwriting the installed file

### Requirement: Identifiers survive a move

A component that moves between folders SHALL keep its element ids,
`aria-label`s, test ids and `data-slot` names unchanged, and a component of
the file explorer's tree SHALL keep its element structure as well.

#### Scenario: A test or the designer's Studio finds an element after a move

- **WHEN** a component has moved to a layer
- **THEN** every selector that found its elements before the move still finds
  them
