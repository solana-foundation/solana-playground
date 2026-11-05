## ADDED Requirements

### Requirement: A toast's Close sits inside it

A toast that can be closed SHALL show its Close button inside the card, at its
end, on the first line of the message, and a toast's message SHALL always
leave room at its end so a long line never runs under Close. Close SHALL never hang off the card's
corner.

#### Scenario: A long toast at the bottom left

- **WHEN** a closable toast with a two-line message shows at the bottom left
- **THEN** its Close sits inside the card at the end of the first line
- **AND** no word of the message sits under Close
