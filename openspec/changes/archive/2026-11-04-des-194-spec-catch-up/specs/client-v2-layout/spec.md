## ADDED Requirements

### Requirement: The phone editor scrolls as a phone does

Below 768 px the code editor SHALL show no minimap and no overview ruler, and
its scrollbar SHALL be a 3 px rounded slider, 3 px in from the edge, with no
track, shown only while the code moves and faded once it stops; scrolling
SHALL be smooth. A wider screen keeps the editor's minimap, overview ruler and
default scrollbar.

#### Scenario: The editor on a phone

- **WHEN** a file is open in the editor on a 390 px wide screen
- **THEN** no minimap and no overview ruler are drawn
- **AND** the scrollbar shows as a thin pill only while the code scrolls

#### Scenario: The editor on a desk

- **WHEN** a file is open in the editor on a 1440 px wide screen
- **THEN** the minimap and the overview ruler are drawn
