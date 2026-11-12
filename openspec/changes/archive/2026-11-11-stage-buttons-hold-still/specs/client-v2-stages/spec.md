## ADDED Requirements

### Requirement: A stage's buttons hold still while their action runs

While a Build, Deploy or Interact stage's action runs, no button in that
stage SHALL move sideways: a button whose label changes while it waits SHALL
be as wide busy as idle, and the stage SHALL keep the room of its scrollbar
whether or not its content overflows. One exception stands until HOO-2796
settles the Deploy stage's action row: the Deploy pill alone in that row may
change its width between its idle label ("Deploy to <cluster>", "Redeploy
to <cluster>") and its busy one ("Deploying...", "Upgrading..."), keeping
its centre. The first Build pill ("Build", with its play mark) is not
held: the first build replaces it with the run's progress bar and Stop, so
it is not on screen while the build runs. The busy button's accessible name SHALL
be the label it shows ("Building…", "Sending…"), and it SHALL carry
`aria-busy="true"` while it waits.

#### Scenario: Build again keeps the action row in place

- **WHEN** a build has succeeded, the code has not changed since, and the
  user presses the outline "Build again" beside "Continue to Deploy"
- **THEN** "Build again" reads "Building…" until the build ends
- **AND** neither "Build again" nor "Continue to Deploy" moves sideways in any
  frame while it runs

#### Scenario: Send keeps the card's row in place

- **WHEN** a wallet is connected and the user presses Send on an instruction
  card with inputs
- **THEN** Send reads "Sending…" until the call settles
- **AND** neither Send nor "Fill with Random" nor "Reset" moves sideways in
  any frame while it runs

#### Scenario: A deploy that outgrows the stage (manual)

- **WHEN** a deploy runs in a window short enough for the Deploy stage to
  overflow, in a browser that shows classic scrollbars
- **THEN** the stage's content does not move sideways when the scrollbar
  appears
