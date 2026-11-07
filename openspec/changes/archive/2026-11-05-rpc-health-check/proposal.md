# Proposal

## Why

Spec 07 (Settings) asks for one network control and a reachability check before a custom RPC is saved. Today the Connection section still shows an Endpoint select with Custom beside the Network chips (SET-08), and a custom RPC is saved after a format check only, so a typo in a host is found only when the first request fails (SET-16). HOO-2591 closes both, after HOO-2489 shipped the saved list.

## What Changes

- Settings no longer draws the Connection section's Endpoint select. The Network row (its chips and the custom RPC list) is the only place the network is chosen. The setting itself stays; only its row goes.
- Saving a custom RPC (a new one, or an edit that changes its URL) first sends one health request to the URL, with a 5 s timeout. The format and duplicate checks run before it, so a refused value sends nothing.
- While the check runs, the Save button shows a spinner and the form's fields are read-only.
- Any HTTP answer within 5 s saves and picks the RPC. No answer (timeout, DNS failure, a browser-blocked request) shows "This URL is not responding." with a "Use anyway" button that saves and picks it anyway.
- Offline, the field shows "You're offline, so this URL can't be checked." with "Use anyway"; nothing is sent.
- An edit that keeps the URL (a rename) saves at once, with no request.
- Telemetry (`settings-page` widget): `settings_custom_rpc_refused` gains the reasons `no_answer` and `offline`; `settings_custom_rpc_saved` gains `check` (`passed`, `used_anyway`, `none`). No event is added or renamed, and none carries a URL, a host or a name.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-custom-rpcs`: the URL is checked for an answer before it is saved; the Network row is the only network control; the telemetry parameters above.

## Impact

- `client-v2/src/entities/custom-rpc`: a pre-save check that answers format and duplicate refusals without writing, and the health request.
- `client-v2/src/widgets/settings-page`: the form's checking and no-answer states, `NetworkSection`'s save path, the page's settings list without `connection.endpoint`, the two telemetry parameters.
- One extra request to a URL the person typed, only on save. A user's RPC with a key in its path receives a `getHealth` POST at the same URL and key.
- Out of scope: the "{Network} is not responding" state for a network already picked, the Deploys line, Surfpool as a chip, and the OpenAI key check, all elsewhere in Spec 07. The terminal's `solana config set --url` is untouched.
