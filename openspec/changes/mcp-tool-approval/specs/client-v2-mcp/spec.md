# Spec Delta

## ADDED Requirements

### Requirement: A user-added server's tool runs only after approval

A tool call the assistant makes on an MCP server the user added SHALL wait for the user's answer on an approval card
in the thread before any request for that call is sent. The card SHALL ask `Call <tool> on <server>?`, and SHALL show
the tool's name, the call's arguments as JSON, and the host of the server's URL. A tool of a server the deployment's
gateway offers SHALL run without a card.

#### Scenario: An approved call runs (manual)

- **WHEN** the assistant calls a tool of a user-added server and the user presses Allow on its card
- **THEN** the call is sent to the server, the card shows its outcome, and the tool's result reaches the assistant

#### Scenario: A gateway server's tool runs unattended (manual)

- **WHEN** the assistant calls a tool of a server the gateway offers
- **THEN** no approval card appears and the call is sent at once

### Requirement: A declined tool call reaches no server

When the user denies the card, or the turn ends before an answer, the call SHALL NOT be sent to the MCP server, and
the assistant SHALL receive a refusal saying the user declined the call.

#### Scenario: A declined call (manual)

- **WHEN** the user presses Deny on an MCP tool call's card
- **THEN** no request for that call reaches the server, and the model's tool result says the user declined it

#### Scenario: A turn stopped while the card waits (manual)

- **WHEN** the user stops the turn while an MCP tool call's card is pending
- **THEN** no request for that call reaches the server

### Requirement: An answered MCP tool card is reported

The event `assistant_approval_answered` SHALL fire once per answered card with `kind`: `patch` for a file change,
`command` for a build or deploy, `tool` for an MCP tool call; and `decision`: `allow` or `deny`. It SHALL carry no
tool name, server, or arguments.

#### Scenario: Answering an MCP tool card (manual)

- **WHEN** the user presses Allow on an MCP tool call's card
- **THEN** `assistant_approval_answered` fires once with `kind: "tool"` and `decision: "allow"`
