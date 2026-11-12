## MODIFIED Requirements

### Requirement: The head names the off state

While the assistant is off for one of the reasons `#assistant-ai-off` names, the assistant's head SHALL show a status `#assistant-status`, a status dot beside a word, after the head's title: "Off" when there is no hosted model or nobody is signed in, and "Not responding" when the hosted model's availability is unknown. The head SHALL show it in Sources and tools too, where the composer and its row are not on screen. It SHALL NOT show while a model can answer or while the deployment's answer is still being read.

#### Scenario: The head says the assistant is off

- **WHEN** the status route answers `key: "own"`, nothing is connected, and the panel opens
- **THEN** `#assistant-status` reads "Off"

#### Scenario: The head says the model is not responding

- **WHEN** `GET /api/ai/status` fails and nothing is connected
- **THEN** `#assistant-status` reads "Not responding"

#### Scenario: No status once a model answers (manual)

- **WHEN** the row stands and the person connects a key-based backend
- **THEN** neither `#assistant-ai-off` nor `#assistant-status` shows

#### Scenario: The head keeps the status in Sources and tools (manual)

- **WHEN** the head shows "Off" and the person opens Sources and tools
- **THEN** `#assistant-status` still reads "Off", though `#assistant-ai-off` is not on screen
