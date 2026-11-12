# Proposal

## Why

Settings, Network offers only Devnet and Mainnet. People who build against their own RPC (Triton, Helius, a local validator) have one hidden "Custom" value in the Connection section's Endpoint select, and lose it as soon as they pick another network. The demo-build review of 30 Oct asked for several saved custom RPCs that the user picks beside Devnet and Mainnet (HOO-2489).

## What Changes

- The Network row's chips read Devnet, Mainnet, then one chip per saved custom RPC, under its name.
- A list under the chips shows each saved RPC: its name, its host (never the path or query), Edit and Remove.
- "Add custom RPC" opens an inline form: Name, then URL with "Save". A saved RPC is picked at once.
- A URL must be `https://`, or `http://` on `localhost` or `127.0.0.1`. A URL already saved is refused.
- Remove shows a toast with Undo; removing the picked RPC moves the network to Devnet and says so.
- The list is kept in this browser under its own `localStorage` key. A profile already on a custom URL sees it in the list, named by its host.
- Telemetry (`settings-page` widget): adds `settings_custom_rpc_saved`, `settings_custom_rpc_removed` and `settings_custom_rpc_refused`. None carries a URL, a host or a name.

## Capabilities

### New Capabilities
- `client-v2-custom-rpcs`: saving, picking, editing and removing several custom RPCs in Settings, Network, and how they are stored.

### Modified Capabilities

None.

## Impact

- New entity `client-v2/src/entities/custom-rpc` (the list, its storage and the URL rule).
- `client-v2/src/widgets/settings-page`: the Network row's chips take saved RPCs; a new list and form; three telemetry events.
- `connection.endpoint` keeps its stored shape (`{ option: "custom", url }` for the picked custom RPC); HOO-2498 owns how that value reads back.
- Out of scope: the 5 s health check and "Use anyway" (Spec 07, SET-16), and removing the Connection section's Endpoint select (SET-08). Both went to Lead's intake. Sync of the list across devices is not planned: it stays in this browser.
