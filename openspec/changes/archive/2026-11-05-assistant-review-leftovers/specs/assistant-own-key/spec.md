# Spec Delta

## MODIFIED Requirements

### Requirement: A rejected key can be entered again

When the provider answers a turn on a key-based backend with 401, the turn
SHALL end in an error that names the provider as the assistant's head does
(Anthropic, OpenAI, OpenRouter, Gemini) and says its key was not accepted,
without the status code: "{Provider} did not accept this key." Its buttons say
what to do. The error SHALL carry a **Change key** button
(`#assistant-enter-key`) that opens Connect a model preset to that backend with
an empty key field. While the deployment serves a hosted model, the error SHALL
also carry a **Use hosted model** button (`#assistant-use-hosted`) that switches
the thread to the hosted model without sending anything, and puts the last
message the user sent back in the composer when the composer is empty; for a
signed-out user it SHALL instead open Connect a model on the hosted model. Both
buttons SHALL be offered only while nothing but notices follows that error and
the thread is not connected to a different backend, so a switch cannot be
pressed twice; with nothing connected, as after a reload, they SHALL stay. Both
SHALL be at least 44px tall below the `md` breakpoint. Other failures, a 403
included (a valid key without access to the model), keep their current error.

#### Scenario: A 401 offers Change key

- **WHEN** the user is connected to a key-based backend and a turn's request
  is answered with 401
- **THEN** the chat shows "OpenAI did not accept this key." with a **Change
  key** button, and pressing it opens
  Connect a model with that provider selected and the key field empty

#### Scenario: A 401 offers the hosted model

- **WHEN** a signed-in user's turn on a key-based backend is answered with 401
  on a deployment that serves a hosted model, and the user presses **Use hosted
  model**
- **THEN** the thread is connected to the hosted model, nothing is sent, and
  the refused message is back in the composer

#### Scenario: The buttons go once the thread has moved (manual)

- **WHEN** a signed-in user has pressed **Use hosted model** on a refused key's
  error
- **THEN** the error shows neither **Change key** nor **Use hosted model**

#### Scenario: The buttons survive a reload (manual)

- **WHEN** a thread whose last word is a refused key's error loads with nothing
  connected
- **THEN** the error still offers **Change key**

Both checked by unit tests in `client-v2/src/widgets/assistant/ui/Thread.test.tsx`.

#### Scenario: A 403 or a 500 keeps the ordinary error (manual)

- **WHEN** a turn's request is answered with 403 or 500
- **THEN** the chat shows the provider's error without a **Change key** or
  **Use hosted model** button

Checked by a unit test in `client-v2/src/widgets/assistant/model/use-turn.test.tsx`.

### Requirement: Recovering a backend is measured

The assistant widget SHALL report, through its tracker:

- `assistant_connect_opened` with `via` `"thread"` when a send with nothing
  connected opens Connect a model preset to the thread's own backend,
  `"key-rejected"` when the **Change key** button opens it, and `"use-hosted"`
  when **Use hosted model** opens it for a signed-out user; its other values
  (`"menu"`, `"model"`, `"send"`, `"setup"`) are unchanged.
- `assistant_key_rejected` when a turn on a key-based backend ends on 401,
  with `provider` the backend's provider id. It carries nothing else: no key,
  no model, no base URL.
- `assistant_model_picked` with `provider` `"default"` and `via`
  `"key-rejected"` when **Use hosted model** switches the thread; its other
  `via` values (`"menu"`, `"dialog"`) are unchanged.

#### Scenario: A rejected key is counted (manual)

- **WHEN** a turn's request on a key-based backend is answered with 401
- **THEN** `assistant_key_rejected` is reported once with the provider

#### Scenario: A switch to the hosted model from a refused key is counted (manual)

- **WHEN** a signed-in user presses **Use hosted model** on a refused key's
  error
- **THEN** `assistant_model_picked` is reported once with `provider`
  `"default"` and `via` `"key-rejected"`

#### Scenario: The two ways into Connect a model are told apart (manual)

- **WHEN** a user presses **Change key**, or a signed-out user presses **Use
  hosted model**, on a refused key's error
- **THEN** `assistant_connect_opened` is reported with `via` `"key-rejected"`
  and `"use-hosted"` respectively

Checked by unit tests through the memory provider in
`client-v2/src/widgets/assistant/model/use-turn.test.tsx` and
`client-v2/src/widgets/assistant/ui/Thread.test.tsx`.
