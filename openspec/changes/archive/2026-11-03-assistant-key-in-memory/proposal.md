# Proposal

## Why

The 29 Oct security review (HOO-2423) found that the user's own model key
outlives their intent: it is kept in the tab's `sessionStorage`, reconnects
on every reload, and is readable by any script running on the origin,
project code included. Nothing in the app lets the user remove it outside
the assistant head's More menu.

## What Changes

- **BREAKING (behaviour):** the user's own key is held in the tab's memory
  only. Connecting writes nothing that holds the key to `sessionStorage`,
  `localStorage` or IndexedDB. A reload leaves the assistant unconnected;
  the next send opens Connect a model preset to the remembered provider and
  model, with the key field empty.
- A key an older build kept in `sessionStorage` (`assistant.connection`) is
  removed on the first load of this build.
- Settings gets an **Assistant** section, second after Network, with a
  "Your model key" row and a destructive **Delete my key** button. Pressing
  it drops the key and the connection, as Forget key did.
- The assistant head's More item "Forget key" is renamed **Delete my key**;
  it does what it did.
- The Connect a model note says the key stays in this tab's memory until a
  reload, a close or Delete my key.
- Telemetry: `settings_key_deleted` (settings-page) when Delete my key is
  pressed in Settings; `assistant_key_deleted` (assistant) when it is picked
  from the head's More. No event is renamed or removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `assistant-own-key`: "The key survives a reload of its tab" and "The key
  is kept per tab" are replaced by "The key is held in memory only";
  "Disconnecting forgets the key" is replaced by "Delete my key removes the
  key", which adds the Settings button and the measured events.

## Impact

- `client-v2/src/views/sidebar/assistant/model/remembered-backend.ts`: no
  longer writes or reads the key; keeps only the keyless choice, plus a
  one-time removal of the legacy entry.
- `client-v2/src/widgets/assistant/model/use-turn.ts`: no kept-key reconnect
  on mount.
- `client-v2/src/widgets/assistant/ui/BaseAssistantHead.tsx`,
  `Assistant.tsx`, `views/sidebar/assistant/Component/Connect.tsx`: copy.
- `client-v2/src/widgets/settings-page/`: the Assistant section and its
  event.
- `client-v2/e2e/assistant-reconnect.e2e.spec.ts` and the specs that seed a
  kept connection: follow the new scenarios.
- Out of scope: holding the key in an iframe on a separate origin
  (HOO-2426, which this unblocks), the designers' Settings key row with
  Save and the last four characters (Settings spec 07), and the provider
  list.
