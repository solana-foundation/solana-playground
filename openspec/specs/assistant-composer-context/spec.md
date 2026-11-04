# assistant-composer-context Specification

## Purpose
Shows and lets the person steer what goes with each message to the assistant, offers the composer's + menu, and keeps focus where the person will type.

## Requirements

### Requirement: Each context chip names what it sends
Every chip over the composer SHALL have an accessible name that says what is sent with the message, for example "Sent with this message: lib.rs, in full". The visible label is the file's name; the tooltip gives its path. On a phone each chip and its remove button SHALL be a target at least 44 px tall.

#### Scenario: The open-file chip's name (manual)
- **WHEN** `src/lib.rs` is an open tab in the context
- **THEN** its chip's accessible name is "Sent with this message: lib.rs, in full"

### Requirement: The composer's + menu
The composer SHALL show a button named "Add context" that opens a menu with "Add a file" (a submenu, see "Add a file from the + menu"), "Sources and tools" (shortcut S) and, with nothing connected, "Connect a model…" or, once connected, "Connection and key…" (shortcut K), the last two doing what the same entries in the head's More do; More SHALL name its entry the same way. Opening Connect a model from it SHALL send `assistant_connect_opened` with `via: "add"`.

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

### Requirement: The context is the open tabs plus added files

The assistant's context SHALL be every open tab plus every file the person added from the + menu, minus every file the person removed. Each turn's project state SHALL carry each file of the context in full, and SHALL NOT name any other project path, with one stated exception: a failed build's compiler output is sent as it is and can name or quote any file. A deleted file SHALL leave the context.

#### Scenario: Only the context reaches the model

- **WHEN** a project holds `src/lib.rs` (open), `client/client.ts` (open), `tests/anchor.test.ts` (added) and `secret/other.rs` (neither), and the person sends a message
- **THEN** the request carries the three files' content, and neither the path nor the content of `secret/other.rs`

### Requirement: The model reads only the context

`read_file` SHALL return a file's content only when the file is in the context. For any other path it SHALL return, without the content, a message telling the model that the file is not in the conversation's context and to ask the person to add it with + in the composer. No tool SHALL list the project's files. `write_file` still accepts any path inside the project, behind the person's approval; it SHALL answer that a file already holds the proposed content only for a file in the context, and SHALL refuse a path that leaves the project.

#### Scenario: Reading a file outside the context (manual)

- **WHEN** the model calls `read_file` with `secret/other.rs`, which is neither open nor added
- **THEN** the result names the path, says it is not in the context, asks for + in the composer, and carries none of the file's content

### Requirement: A file can be removed from the context

Every file chip SHALL carry a button named "Remove <file> from the context". Pressing it SHALL remove the chip and keep the file out of every following message until the person adds it back from the + menu, even while its tab stays open, and SHALL send `assistant_file_chip_removed` (no parameters).

#### Scenario: Remove an open tab from the context

- **WHEN** `src/lib.rs` is open, the person presses "Remove lib.rs from the context" and sends two messages
- **THEN** neither request carries `src/lib.rs`, its chip stays gone, and `assistant_file_chip_removed` was sent once

### Requirement: Add a file from the + menu

The + menu SHALL offer "Add a file", a submenu listing by relative path every project file not in the context. Picking one SHALL add it to the context, show its chip and send `assistant_context_file_added` with `via: "menu"`, the only value so far. With every file in the context, the submenu SHALL say "Every file is in the context" and offer nothing.

#### Scenario: Add a file that is not open

- **WHEN** the person opens "Add context", then "Add a file", and picks `tests/anchor.test.ts`
- **THEN** a chip "anchor.test.ts" appears, the next request carries that file in full, and `assistant_context_file_added` is sent with `via: "menu"`

### Requirement: Choices belong to their project

Files added and files removed SHALL apply to the project they were chosen in, and SHALL be kept for it while the page is open, across a switch to another project and back and across a rename. Another project SHALL start from its own open tabs. A reload SHALL start from the open tabs. Deleting a file SHALL drop the choices about it, so a new file made at its path is not in the context until it is added. Renaming or moving a file or a folder SHALL carry the choices about it, and about every file under the folder, to the new path, so a removed file stays out of the context.

#### Scenario: Rename a removed file's folder (manual)

- **WHEN** the person removed `src/keys/secret.rs` from the context, then renames `src/keys` to `src/vault`
- **THEN** `src/vault/secret.rs` stays out of the context while its tab stays open

#### Scenario: Switch projects (manual)

- **WHEN** the person removed `secret.rs` in project A, added a file in project B, then returns to A
- **THEN** B's chips were B's open tabs plus its added file, and in A `secret.rs` is still out of the context
