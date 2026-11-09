## ADDED Requirements

### Requirement: Build succeeded leads with Build again once the code changed

Build succeeded SHALL make Build again its brand action, with Continue to
Deploy outlined and still usable, while the program's source files differ from
those the last successful build was given. Without a difference Continue to
Deploy SHALL be the brand action and Build again outlined. A rename alone, and
a change outside the files a build sends, and the declared program id, which a
build writes itself, SHALL NOT count as a difference.

#### Scenario: The code changed after the build

- **WHEN** a build succeeded and the user then edits a file under `src/`
- **THEN** Build again is the brand action
- **AND** the screen says "Your code changed after the last build. Build again before you deploy."
- **AND** Continue to Deploy is outlined and still goes to Deploy

#### Scenario: The program id a build writes is not a change

- **WHEN** a first build writes the program id into `declare_id!` and succeeds
- **THEN** Continue to Deploy stays the brand action

#### Scenario: A rename is not a change

- **WHEN** a build succeeded and the user renames a file under `src/`, changing no text
- **THEN** Continue to Deploy stays the brand action

#### Scenario: An undone edit is not a change

- **WHEN** the user edits a file under `src/` after a successful build and restores its text
- **THEN** Continue to Deploy is the brand action again

#### Scenario: A rebuild settles it

- **WHEN** the code changed and the user builds again successfully
- **THEN** Continue to Deploy is the brand action again
