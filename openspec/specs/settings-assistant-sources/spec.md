# settings-assistant-sources Specification

## Purpose
The assistant's skills and MCP servers are reachable from Settings › Assistant, with the same controls and state as the panel's Sources and tools, so a user finds them without opening the assistant.

## Requirements

### Requirement: Settings › Assistant shows the skills and MCP servers

The Assistant section of Settings SHALL hold, after the hosted model's card, a
card titled "Skills and MCP servers" with the same controls as the assistant's
Sources and tools view: the skills with their checkboxes, the community skills,
the MCP servers with their checkboxes, and the additional servers editor. Both
views SHALL read and write the same assistant state, so a skill or server
switched in one SHALL show switched in the other, and the next turn SHALL offer
only what is checked. Opening the section SHALL ask the gateway for its skills
and servers, so the lists fill without the assistant panel. The section SHALL
render while nobody is signed in and while the assistant is off, showing the
lists' empty states when the gateway lists nothing. Both views MAY be on screen
at once, and a click on a name SHALL toggle that view's own checkbox.

#### Scenario: A skill unticked in Settings
- **WHEN** the user unticks a skill in Settings › Assistant
- **THEN** the skill is unticked in the panel's Sources and tools, and the
  next turn does not list it

#### Scenario: Nothing listed
- **WHEN** the section opens while the skills route and the gateway list
  nothing
- **THEN** the card shows "The server reported no skills" and the no-servers
  line, and nothing throws

#### Scenario: Both views on screen
- **WHEN** Sources and tools is open in the panel and the user opens
  Settings › Assistant
- **THEN** a click on a skill's name in Settings toggles the checkbox in
  Settings, and the panel shows the same state on the way back
