# assistant-conversation-history Specification

## Purpose
Says what a stored assistant thread keeps of each turn, and what a provider
built for a stored thread sends the model as the conversation so far, so the
model remembers what it did after a reload, on another device, or after a
backend switch.

Its scenarios are checked by unit tests, not in the browser, so they carry the
`(manual)` mark: `src/features/persistence/model/replay.ts`,
`src/features/persistence/model/chat-codec.ts`,
`src/features/persistence/model/tool-call.ts`,
`src/views/sidebar/assistant/store.ts`,
`src/widgets/assistant/ui/BaseThreadItem.test.tsx`,
`src/shared/lib/ai/run-turn.test.ts`,
`src/widgets/assistant/model/use-turn.test.tsx` and
`src/views/sidebar/assistant/model/provider.test.ts`, all under `client-v2/`.

## Requirements

### Requirement: A finished tool call is stored with its thread

Every tool call whose tool returned or failed SHALL be stored in the thread, in
the order it finished relative to the turn's text, with the tool's name, its
input, its result as text, and whether it failed. A call the turn abandoned
before its tool returned (Stop, a closed thread) SHALL NOT be stored. The
stored call SHALL travel with the thread to local storage and to the account.

#### Scenario: A read is stored (manual)

- **WHEN** a turn calls `read_file` with `{ "path": "src/lib.rs" }` and the tool returns the file
- **THEN** the thread holds that call with name `read_file`, that input, the file as its result, and no failure

#### Scenario: A failed tool is stored as failed (manual)

- **WHEN** a tool throws `Not found` during a turn
- **THEN** the thread holds that call with `Not found` as its result, marked failed

#### Scenario: A stopped call is not stored (manual)

- **WHEN** the person stops the turn while a tool is still running
- **THEN** the thread holds no stored call for it

#### Scenario: A stored call survives storage and sync (manual)

- **WHEN** a thread holding a stored call is written to local storage, read back, merged with the account's copy and decoded
- **THEN** the call comes back with the same name, input, result and failure mark

### Requirement: A stored call is capped in size

Before a call is stored, each text value in its input longer than 1,000
characters, and a result longer than 4,000 characters, SHALL be cut to that
length and end with a marker giving the number of characters cut. An input
still longer than 2,000 characters once serialised SHALL be replaced by a note
giving its size. An input that is not an object SHALL be stored wrapped in
one, and an empty result as `(no output)`. Stored text SHALL hold no NUL and
no unpaired surrogate. A tool name outside `[a-zA-Z0-9_-]` SHALL be stored
with every other character replaced by `_`, starting with `_` when it does
not start with a letter or `_`, at most 64 characters long, and `tool` when
nothing is left. The connection's key SHALL NOT
appear in a stored call. Failing to store a call SHALL NOT fail its turn.

#### Scenario: A long result is cut with a marker (manual)

- **WHEN** a tool returns 10,000 characters
- **THEN** the stored result holds the first 4,000 and a marker saying 6,000 characters were cut

#### Scenario: A long input value is cut, the shape kept (manual)

- **WHEN** `write_file` is called with a 3,000-character `content`
- **THEN** the stored input keeps `path` whole and holds the first 1,000 characters of `content` with a marker

#### Scenario: Arguments the model got wrong are stored as an object (manual)

- **WHEN** a call's input is the text `{"path": "src/li`
- **THEN** the stored input is `{ "value": "{\"path\": \"src/li" }`

#### Scenario: A call that cannot be stored is reported (manual)

- **WHEN** storing a call fails
- **THEN** the failure is logged for reporting, nothing is stored for it, and the turn goes on

#### Scenario: Text Postgres refuses is not stored (manual)

- **WHEN** a tool's result holds a NUL character, or a cut would split an emoji
- **THEN** the stored result holds neither the NUL nor half of the emoji

#### Scenario: A made-up tool name is stored as one a backend takes (manual)

- **WHEN** the model calls `functions.read file`, a tool that does not exist
- **THEN** the stored call is named `functions_read_file`

#### Scenario: The key is redacted (manual)

- **WHEN** a tool's result contains the connection's key
- **THEN** the stored result holds the redaction in its place

### Requirement: A reopened thread replays its stored calls

A provider built for a thread that is already stored SHALL send the model, in
place, each stored call as a tool call followed by its tool result, between the
text that came before and after it, for the newest calls that fit 64,000
characters together as JSON; older calls SHALL be left out. The replay SHALL
open on the thread's first user message. A tool item that carries no stored call
SHALL be left out, as today. A thread holding no stored calls SHALL replay as
text only, as before. For a file that is not in the context when the replay
is built, the replay SHALL send a note that the file was taken out of the
context in place of what a `read_file` call returned and of the content a
`write_file` call wrote; the stored thread SHALL keep the call whole. A
provider whose history may hold such a file's content SHALL be rebuilt from
the thread before the next message is sent.

#### Scenario: A reload keeps what the model read (manual)

- **WHEN** a thread with the message "read lib.rs", a stored `read_file` call and the reply "It has one function" is reopened and the person sends another message
- **THEN** the request carries the message, a tool call to `read_file` with its input, the tool result, the reply, then the new message, in that order

#### Scenario: A failed call replays as an error result (manual)

- **WHEN** a thread holding a failed stored call is replayed
- **THEN** the tool result is sent as an error with the stored text

#### Scenario: Two calls in one turn replay in order (manual)

- **WHEN** a turn stored two calls before its reply
- **THEN** the replay sends each call followed by its own result, in the order they finished, and each result names its own call

#### Scenario: A long thread replays its newest calls (manual)

- **WHEN** a thread holds 30 stored calls with 4,000-character results (about 4,030 characters each with name and input)
- **THEN** the replay sends the newest 15 and leaves the 15 oldest out

#### Scenario: A replay opens on a user message (manual)

- **WHEN** a thread cut to its newest items opens on a reply and a stored call
- **THEN** the replay leaves both out and opens on the first user message

#### Scenario: A file taken out of the context is not replayed (manual)

- **WHEN** the model read `src/secret.rs`, the person removes its chip and sends another message, or reopens the thread later
- **THEN** the request carries the `read_file` call with a note in place of its result, and none of the file's content

#### Scenario: A thread from before replays as text (manual)

- **WHEN** a thread whose tool items carry no stored call is replayed
- **THEN** the request carries only its messages and replies, as before this change

### Requirement: A stored call is not drawn in the thread

The thread SHALL draw nothing for a stored call. The marker each tool writes
("read src/lib.rs") SHALL be drawn as before, so the thread looks the same
with or without stored calls.

#### Scenario: The thread looks as before (manual)

- **WHEN** a thread holding a marker and its stored call is shown
- **THEN** the thread shows the marker once and nothing for the stored call
