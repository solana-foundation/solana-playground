# client-v2-search-field Specification

## Purpose
The search field offers values to pick from a list under it, such as an
Interact instruction's generated values and an account's address, and says
when what was typed is not valid.

## Requirements

### Requirement: A value can be picked from the field's list

A search field with something to pick SHALL open its list
(`data-slot="command"`) in a popover when clicked, with keyboard focus left in
the field, and picking an item SHALL fill the field with that item's value. An
item its caller sets apart (Interact's Random) SHALL be a button named by the
item inside the field instead of a row in the list, and pressing it SHALL fill
the field as picking the row did. A field with nothing else to pick (an item
shown only when the input is valid, Custom, does not count) SHALL be a plain
textbox: no list, no chevron, and Escape or a click outside SHALL keep what
was typed. A field with a list SHALL show a chevron ("Show options") that
toggles it; a magnifier ("Search") SHALL show only where the caller asks for
search. The field keeps the `id` its user gives it.

#### Scenario: Random fills an instruction value

- **WHEN** a deployed program's instruction takes a `u64` argument and the
  user presses the Random button in that argument's field in the Interact
  stage
- **THEN** the field (`#initializeargsamount`) holds a whole number, and no
  list opened

#### Scenario: A public key still offers its list (manual)

- **WHEN** the user presses the chevron in an account's field of an
  instruction
- **THEN** the list opens with its picks (From seed, wallets, accounts), and
  Random is the button in the field, not a row

### Requirement: An invalid value marks the field

When the field's validator rejects what was typed, the input SHALL carry
`aria-invalid="true"`, and SHALL lose it once the value is valid again.

#### Scenario: An address that is not a public key

- **WHEN** the user types "not-a-key" into an account's address field in the
  Interact stage's Accounts section
- **THEN** that field carries `aria-invalid="true"`
