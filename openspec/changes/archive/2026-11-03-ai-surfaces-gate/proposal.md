# Proposal

## Why

A signed-out visitor on a deployment with a hosted key sees a composer that
looks live, types a question, and only then is sent to sign in; a deployment
whose hosted model cannot be reached keeps Send enabled and fails the turn.
The assistant should either work or say, before anyone types, why it does not
and where to get a key. HOO-1746 added `GET /api/ai/status` as the one answer
the client gates on; this change is the client side (HOO-1747).

## What Changes

- The panel learns whether the deployment offers a hosted model from
  `GET /api/ai/status` instead of `GET /api/agent`. `GET /api/agent` keeps
  serving its probe until a later ticket retires it.
- When nothing usable is connected and the hosted model cannot answer this
  user, the composer stays on screen and a row above it says why and what to
  do, and Send is blocked:
  - no hosted model on this deployment: the user adds a key of their own;
  - a hosted model, signed out: the user signs in with GitHub or adds a key;
  - the hosted model cannot be reached: the user tries again or adds a key.
- The "Your prompt is waiting" notice is folded into that row, so a prompt
  sent from outside the panel (Build's Ask, the server console, a lesson's
  objective, Home) lands in the composer unsent and the row explains it. Those
  entry points stay where they are.
- Telemetry (`widgets/assistant`): adds `assistant_ai_off_shown` and
  `assistant_default_probe_retried`; adds the value `"ai-off"` to
  `assistant_connect_opened`'s `via`, and `"session"` to
  `assistant_default_probe_failed`'s `reason`.

## Capabilities

### New Capabilities

- `assistant-ai-gate`: where the assistant learns whether a hosted model is
  available, and what the panel shows and blocks while no model can answer.

### Modified Capabilities

- `assistant-model-name`: "Send waits while there is no model" now also
  covers a signed-out user and an unreachable hosted model, each with its own
  reason in Send's tooltip.

## Impact

- Code: `client-v2/src/widgets/assistant` (the probe, the composer, telemetry),
  and the e2e specs that stub the probe (moved from `**/api/agent` to
  `**/api/ai/status`).
- User-visible: on a deployment with no hosted key, signed out, or with the
  hosted model unreachable, the composer says so before anything is typed and
  offers the one way in.
- Out of scope: the status indicator in the navigation (HOO-2483), "Limit
  reached" for the hosted daily cap, retiring `GET /api/agent`'s probe, a key
  row in Settings, and hiding entry points outside the panel.
