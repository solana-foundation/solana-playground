# assistant-ai-gate Specification

## Purpose

Where the assistant learns whether this deployment offers a hosted model, and
what the panel shows and blocks while no model can answer the person using it,
so the assistant either works or says why not before anything is typed.

## Requirements

### Requirement: The panel reads hosted-model availability from the status route

The assistant SHALL learn whether the deployment offers a hosted model, and that model's id, from `GET /api/ai/status` and from no other route. It SHALL read the hosted model as offered when the answer's `key` is `"hosted"` and its `reason` is not `"unavailable"`, whatever other `reason` it carries; as not offered when `key` is `"own"` or the route answers `404`; and as unknown (not offered, asked again by the next caller) when the request fails, the route answers any other non-`2xx` status, the body is not a status answer, or `reason` is `"unavailable"`. Whether someone is signed in SHALL come from the page's session, as before.

#### Scenario: A hosted key is offered (manual)

- **WHEN** `GET /api/ai/status` answers `{ "available": false, "key": "hosted", "reason": "signed-out", "model": "glm-5.3-flash" }`
- **THEN** the panel reads the hosted model as offered, named `glm-5.3-flash`, and does not request `GET /api/agent`

#### Scenario: No hosted key (manual)

- **WHEN** `GET /api/ai/status` answers `{ "available": false, "key": "own", "reason": null, "model": null }`
- **THEN** the panel reads the hosted model as not offered

#### Scenario: The session lookup failed on the server (manual)

- **WHEN** `GET /api/ai/status` answers `key: "hosted"` with `reason: "unavailable"`
- **THEN** the panel reads the hosted model as unknown, and the next send or retry asks the route again

### Requirement: The composer says why the assistant is off

While nothing usable is connected and the hosted model cannot answer this user, the composer SHALL stay on screen and a row `#assistant-ai-off` with `role="status"` SHALL stand above it, holding one reason, as a title over a body line, and its actions:

- no hosted model on this deployment: title "The assistant has no model", body "The hosted model is not available. Add your own key to use the assistant.", with **Add an API key** and **Try again**;
- a hosted model, nobody signed in: title "Sign in to use the assistant", body "Sign in with GitHub to use the hosted model, or add a key of your own.", with **Sign in with GitHub** and **Add an API key**;
- the hosted model's availability unknown: title "Model not answering", body "The assistant can't reach its model. Try again in a minute.", with **Try again** and **Add an API key**.

**Add an API key** SHALL open Connect a model, preset to the backend that answered the open thread when that backend needs a key. **Sign in with GitHub** SHALL start the same sign-in as Connect a model's, leaving the open project open, and a failed sign-in SHALL say so in the row. **Try again** SHALL ask the status route again. When a prompt is waiting in the composer, the row SHALL add "Your prompt is waiting in the composer." The row SHALL NOT show while the deployment's answer is still being read, while a model is connected, or once the person signs in with a hosted model offered.

#### Scenario: No hosted key, nothing connected

- **WHEN** the status route answers `key: "own"`, no key is kept, and the panel opens
- **THEN** `#assistant-ai-off` reads "The assistant has no model" over "The hosted model is not available. Add your own key to use the assistant.", **Add an API key** opens Connect a model, and Send is disabled with "Connect a model to send"

#### Scenario: Try again with no hosted key

- **WHEN** the status route answers `key: "own"`, nothing is connected, and the person presses **Try again** in `#assistant-ai-off`
- **THEN** `GET /api/ai/status` is requested again

#### Scenario: Signed out with a hosted model

- **WHEN** the status route answers `key: "hosted"`, nobody is signed in, and the panel opens
- **THEN** `#assistant-ai-off` reads "Sign in to use the assistant" and offers **Sign in with GitHub** and **Add an API key**, and Send is disabled with "Sign in to send"

#### Scenario: Signing in turns the assistant on (manual)

- **WHEN** the row offers **Sign in with GitHub** and the person signs in
- **THEN** the row goes away, Send is enabled, and the next send goes to the hosted model

#### Scenario: Hosted model unreachable

- **WHEN** `GET /api/ai/status` fails and nothing is connected
- **THEN** `#assistant-ai-off` reads "Model not answering" over "The assistant can't reach its model. Try again in a minute.", and **Try again** requests `GET /api/ai/status` again

#### Scenario: A prompt sent from outside the panel while the assistant is off

- **WHEN** the status route answers `key: "own"`, nothing is connected, and Build's **Ask** sends a prompt to the assistant
- **THEN** the prompt waits in the composer unsent, and `#assistant-ai-off` adds "Your prompt is waiting in the composer."

#### Scenario: A kept key hides the row (manual)

- **WHEN** the status route answers `key: "own"` and the tab reconnects a kept key-based backend
- **THEN** `#assistant-ai-off` does not show and Send is enabled

### Requirement: The assistant reports the off state

The assistant widget SHALL report, through its tracker:

- `assistant_ai_off_shown` when `#assistant-ai-off` appears, with `reason` one of `"no-key"`, `"signed-out"` or `"unreachable"`, at most once per reason while the composer stays mounted;
- `assistant_default_probe_retried` (no parameters) when **Try again** in the row asks the status route again;
- `assistant_connect_opened` with `via` `"ai-off"` when the row's **Add an API key** opens Connect a model;
- `assistant_default_probe_failed` with `reason` `"session"` when the status route answers `reason: "unavailable"`, alongside its existing `"network"`, `"status"` and `"body"`.

#### Scenario: The off row is reported once per reason (manual)

- **WHEN** the panel shows `#assistant-ai-off` for `"signed-out"`, re-renders, and still shows it
- **THEN** the tracker holds one `assistant_ai_off_shown` with `reason: "signed-out"`

### Requirement: The head names the off state

While the assistant is off for one of the reasons `#assistant-ai-off` names, the assistant's head SHALL show a status `#assistant-status`, a status dot beside a word, after the model label: "Off" when there is no hosted model or nobody is signed in, and "Not responding" when the hosted model's availability is unknown. The head SHALL show it in Sources and tools too, where the composer and its row are not on screen. It SHALL NOT show while a model can answer or while the deployment's answer is still being read.

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
