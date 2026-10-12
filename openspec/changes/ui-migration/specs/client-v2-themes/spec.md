# Spec Delta

## Purpose

Which themes the product offers, which one it starts on, and what a user
whose saved theme no longer exists sees.

## ADDED Requirements

### Requirement: Two themes, dark by default

The product SHALL offer exactly two themes, the design system's dark and
light, and SHALL start on dark when no theme is saved.

#### Scenario: First visit

- **WHEN** a user opens the product with no saved theme
- **THEN** the dark theme is applied and the theme setting shows two choices

#### Scenario: Switching to light

- **WHEN** the user picks light in the theme setting
- **THEN** the whole product, including the editor and the terminal, follows
  the light palette, and the choice is saved

### Requirement: A removed theme falls back to dark, once said

When a saved theme is one the product no longer offers, the product SHALL
apply dark, SHALL tell the user once that the saved theme is gone, and SHALL
save dark so the message does not repeat. The former default, "Solana V2", is
the exception: it was written to storage on every first load, so nobody chose
it, and it moves to dark without the message. A name the product never
offered (a hand edit) also moves to dark without the message.

#### Scenario: A saved Dracula theme

- **WHEN** a user whose saved theme is Dracula opens the product
- **THEN** dark is applied, a notice says the theme was removed and dark is
  now set, and on the next visit no notice appears

### Requirement: Editor and terminal follow the theme

The code editor and the terminal SHALL render in the active theme's colours
and SHALL change when the theme changes, without a reload.

#### Scenario: Theme change with a file open

- **WHEN** the user switches theme while a file and the terminal are open
- **THEN** both re-colour to the new theme immediately
