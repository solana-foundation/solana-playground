# Spec Delta

## Purpose

How the small elements a screen is built from behave for the user: a section
that folds, a checkbox and its label, and a note that says what kind it is.

## ADDED Requirements

### Requirement: A section that folds says whether it is open

A section the user can fold SHALL be folded and unfolded from its heading, by
pointer and by keyboard, and its heading SHALL tell assistive technology
whether the section is open.

#### Scenario: The compiler output folds

- **WHEN** a build fails and the user clicks "Show compiler output" under
  its errors
- **THEN** the compiler's output is shown and the toggle is announced as
  expanded
- **WHEN** the user clicks it again
- **THEN** the output is hidden and the toggle is announced as collapsed

### Requirement: A checkbox is toggled by its label

A checkbox SHALL carry its label as its accessible name, and a click on the
label SHALL toggle it.

#### Scenario: A skill is switched by its name

- **WHEN** a user opens the assistant's sources and clicks the name of an
  enabled skill
- **THEN** the skill's checkbox is unchecked
- **WHEN** the user clicks the name again
- **THEN** the checkbox is checked

### Requirement: A note says what kind it is

A note that reports an error or a warning SHALL be announced to assistive
technology as an alert. Any other note SHALL NOT interrupt as one.

#### Scenario: An unknown page is an alert

- **WHEN** a user opens a URL path the product does not know
- **THEN** the message that the path was not found is announced as an alert
