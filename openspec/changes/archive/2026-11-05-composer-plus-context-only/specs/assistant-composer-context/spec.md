# Spec Delta

## ADDED Requirements

### Requirement: The composer's + menu holds context
The composer SHALL show a button named "Add context" that opens a menu with "Add a file" (a submenu, see "Add a file from the + menu") and "Sources and tools" (shortcut S), the second doing what the same entry in the head's More does. The menu SHALL NOT offer "Connect a model…" or "Connection and key…": those stay on the model button and in the head's More, which names its entry "Connect a model…" with nothing connected and "Connection and key…" once connected.

#### Scenario: Sources and tools from the + menu (manual)
- **WHEN** the person opens "Add context" and picks "Sources and tools"
- **THEN** Sources and tools replaces the conversation and focus is on "Back"

#### Scenario: The + menu holds context only
- **WHEN** nothing is connected and the person opens "Add context"
- **THEN** the menu lists "Add a file" and "Sources and tools", and no entry starting "Connect"

#### Scenario: Once connected (manual)
- **WHEN** a model is connected and the person opens More
- **THEN** the entry reads "Connection and key…"

## REMOVED Requirements

### Requirement: The composer's + menu
**Reason**: The + menu holds only what goes with the message; Connect a model left it (DES-208).
**Migration**: "The composer's + menu holds context" replaces it. Connect a model and Connection and key… stay on the model button and in the head's More; `assistant_connect_opened` no longer has `via: "add"`.
