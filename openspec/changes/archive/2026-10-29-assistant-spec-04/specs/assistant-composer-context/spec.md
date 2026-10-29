# Spec Delta

## Purpose

Shows and lets the person steer what goes with each message to the assistant, offers the composer's + menu, and keeps focus where the person will type.

## ADDED Requirements

### Requirement: Each context chip names what it sends
Every chip over the composer SHALL have an accessible name that says what is sent with the message, for example "Sent with this message: lib.rs, the open file, in full". The visible label and the tooltip stay as they are. On a phone each chip and its remove button SHALL be a target at least 44 px tall.

#### Scenario: The open-file chip's name (manual)
- **WHEN** `src/lib.rs` is the active tab
- **THEN** its chip's accessible name is "Sent with this message: lib.rs, the open file, in full"

### Requirement: The open file can be left out of the next message
The open-file chip SHALL carry a button named "Leave <file> out of the next message". Pressing it SHALL remove the chip; the next message SHALL be sent without that file's content (its path is still named) and SHALL send `assistant_file_chip_removed` (no parameters). After that message, the chip SHALL return. A file the person switches to before sending is sent in full, as its chip says. No other chip can be removed.

#### Scenario: Remove the file chip and send (manual)
- **WHEN** the person presses "Leave lib.rs out of the next message" and sends a message
- **THEN** the turn's project state names `src/lib.rs` without its content, and the chip "lib.rs" is back after the send

### Requirement: The composer's + menu
The composer SHALL show a button named "Add context" that opens a menu with "Sources and tools" (shortcut S) and, with nothing connected, "Connect a model…" or, once connected, "Connection and key…" (shortcut K), doing what the same entries in the head's More do; More SHALL name its entry the same way. Opening Connect a model from it SHALL send `assistant_connect_opened` with `via: "add"`.

#### Scenario: Sources and tools from the + menu (manual)
- **WHEN** the person opens "Add context" and picks "Sources and tools"
- **THEN** Sources and tools replaces the conversation and focus is on "Back"

#### Scenario: Connect a model from the + menu
- **WHEN** nothing is connected and the person opens "Add context" and picks "Connect a model…"
- **THEN** Connect a model opens and `assistant_connect_opened` is sent with `via: "add"`

#### Scenario: Once connected (manual)
- **WHEN** a model is connected and the person opens "Add context" or More
- **THEN** the entry reads "Connection and key…"

### Requirement: A placed prompt takes focus in the composer
When `PgAssistant.requestPrompt` leaves a prompt in the composer for the person to look at (`send: false`), the composer's input SHALL have focus, including when the panel mounts to take the prompt or leaves Sources and tools to show it. Such a prompt sends nothing, so it SHALL NOT open Connect a model or ask for a backend.

#### Scenario: A prompt placed with nothing connected (manual)
- **WHEN** no model is connected and a prompt is requested with `send: false`
- **THEN** the composer holds the prompt with focus, and Connect a model does not open

#### Scenario: A prompt placed while Sources is open (manual)
- **WHEN** Sources and tools is open and a prompt is requested with `send: false`
- **THEN** the conversation shows, the composer holds the prompt, and its input has focus
