## ADDED Requirements

### Requirement: Spaces separate a command's arguments

The terminal SHALL split a typed line into a command's arguments at spaces outside quotes, with a run of spaces
separating as one space does, and with no argument for spaces at the start or the end of the line. A quoted empty
string (`""` or `''`) SHALL be an empty argument. `!!` SHALL expand to the previous line split the same way. Every
command SHALL receive its arguments by this rule.

#### Scenario: Two spaces before an option (manual)

- **WHEN** the person types `anchor idl init <PROGRAM_ID>  --filepath idl.json` with two spaces before the option
- **THEN** the command runs as it does with one space, with no "Unexpected argument" error
