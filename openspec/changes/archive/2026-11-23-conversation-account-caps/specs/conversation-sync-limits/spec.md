## ADDED Requirements

### Requirement: An account stores at most 200 conversations, 20,000 messages and 32 MiB

An account's conversation measures SHALL be, over its live conversations (not
deleted): the number of conversations, the number of their messages, and the
UTF-8 bytes of those messages' stored payloads. A conversation deleted with its
project SHALL NOT count, nor shall its messages, which are erased with it.

`POST /api/conversations` SHALL refuse a push that leaves a measure above its
cap (200 conversations, 20,000 messages, 33,554,432 bytes) and higher than it
was before the push, with status 413 and a JSON body carrying `reason`
(`too-many-threads` | `too-many-messages` | `conversations-too-large`),
`limit` (the cap) and `count` (the measure the push would have made). When a
push breaks more than one cap, the reason SHALL be the first of that order. A
refused push SHALL change nothing in the database.

A push that grows no measure SHALL NOT be refused, also when the account is
already over a cap. Two pushes of one account that race SHALL be measured one
after the other.

#### Scenario: An account under every cap syncs as before
- **WHEN** an account under every cap pushes a thread
- **THEN** the push is accepted and its messages are stored

#### Scenario: A push past the message cap is refused and keeps what was stored
- **WHEN** an account at the message cap pushes a new message
- **THEN** the response is 413 with `reason: "too-many-messages"`, `limit` and `count`
- **AND** every message stored before the push is still stored, and the new one is not

#### Scenario: A new conversation past the thread cap is refused
- **WHEN** an account at the conversation cap pushes a thread it does not hold
- **THEN** the response is 413 with `reason: "too-many-threads"`
- **AND** no conversation row is created

#### Scenario: A push past the size cap is refused
- **WHEN** a push would take the account's stored payload past the size cap
- **THEN** the response is 413 with `reason: "conversations-too-large"`

#### Scenario: A re-push at the cap is accepted
- **WHEN** an account at a cap pushes messages the server already holds
- **THEN** the push is accepted

### Requirement: A conversation is created only under a project the account holds

`POST /api/conversations` SHALL refuse a push whose `projectId` names no
project row of the signed-in account with status 409 and `reason:
"no-project"`, and SHALL NOT create a project row. A project row SHALL come
only from `PUT /api/projects`, under the account's project cap. A push under a
deleted project keeps its 410.

#### Scenario: An unknown project id creates no row
- **WHEN** an account pushes a thread for a project id it has no row for
- **THEN** the response is 409 with `reason: "no-project"`
- **AND** neither a project row nor a conversation row is created

### Requirement: A thread waiting on its project follows the project

The client SHALL keep a thread refused with `no-project` on the device, owed,
and SHALL push it again once the server accepts a push of that project. It
SHALL NOT report the refusal as a failure: it is the expected answer for a
project created while signed out, whose thread the sign-in dump uploads before
the project.

#### Scenario: A project made while signed out keeps its conversation
- **WHEN** a user signs in with a project and a conversation made while signed out
- **AND** the thread's first push is refused with `no-project`
- **THEN** the thread is pushed again after the project's upload is accepted

### Requirement: The assistant panel shows a cap refusal

While the last conversation push was refused for a cap, the assistant panel
SHALL say which cap, with its figure, that new messages stay in this browser,
and that deleting a synced project the user no longer needs deletes its
conversations and makes room. The line SHALL NOT be stored in the thread. It
SHALL go once a push is accepted again.

#### Scenario: The panel names the message cap
- **WHEN** a push is refused with `too-many-messages`
- **THEN** the panel says the account syncs at most 20,000 messages and that new messages stay in this browser
