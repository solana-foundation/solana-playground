# Spec Delta

## Purpose

How the controls the user picks with behave: the development loop's switch,
a choice of a few options, and a select, by pointer and by keyboard.

## ADDED Requirements

### Requirement: The development loop is one switch

The product SHALL present Write, Build, Deploy and Interact as one set of
tabs. Choosing a stage SHALL show that stage. The arrow keys SHALL move
between the stages. Each stage SHALL say its status to assistive technology,
and a failed build SHALL say how many errors it has.

#### Scenario: The stepper drives the stages

- **WHEN** a user clicks Build in the development loop
- **THEN** the Build stage is shown and Build is the selected tab
- **WHEN** the user presses the right arrow key on Build
- **THEN** the focus moves to Deploy

#### Scenario: A failed build says so

- **WHEN** a build fails with errors
- **THEN** the Build tab is announced as failed, with its error count

### Requirement: A choice of a few is one radio group

Where the user picks one option out of a few shown at once, such as the
network in settings, the options SHALL form one radio group: the group is
one stop for the Tab key, and the arrow keys move the choice within it.

#### Scenario: Network by keyboard

- **WHEN** a user focuses the chosen network in settings and presses the
  right arrow key
- **THEN** the next network is chosen and focused

#### Scenario: The backend list by keyboard

- **WHEN** a user opens the other backends and presses the down arrow key
  twice on the chosen backend
- **THEN** the list stays open and the backend two below is chosen and
  focused

### Requirement: Selects open above every panel

A select SHALL open its options above whatever panel or sheet it sits in,
and SHALL be operable from the keyboard: focus, open with the down arrow,
pick an option.

#### Scenario: A setting select

- **WHEN** a user focuses the theme select in settings, presses the down
  arrow key and picks Light
- **THEN** the options are visible above the settings panel and the theme
  becomes Light
