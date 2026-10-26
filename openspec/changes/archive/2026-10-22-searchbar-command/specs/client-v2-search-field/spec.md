# Spec Delta

## Purpose

The search field offers values to pick from a list under it, such as an
Interact instruction's generated values and an account's address, and says
when what was typed is not valid.

## ADDED Requirements

### Requirement: A value can be picked from the field's list

A search field SHALL open its list (`data-slot="command"`) in a popover when
clicked, with keyboard focus left in the field, and picking an item SHALL
fill the field with that item's value. The field keeps the `id` its user
gives it.

#### Scenario: Random fills an instruction value

- **WHEN** a deployed program's instruction takes a `u64` argument and the
  user clicks that argument's field in the Interact stage
- **AND** picks Random
- **THEN** the field (`#initializeargsamount`) holds a whole number

### Requirement: An invalid value marks the field

When the field's validator rejects what was typed, the input SHALL carry
`aria-invalid="true"`, and SHALL lose it once the value is valid again.

#### Scenario: An address that is not a public key

- **WHEN** the user types "not-a-key" into an account's address field in the
  Interact stage's Accounts section
- **THEN** that field carries `aria-invalid="true"`
