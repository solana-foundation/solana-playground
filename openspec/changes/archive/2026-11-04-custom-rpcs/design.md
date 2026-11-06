# Design

## Context

Settings, Network draws `BaseNetworkChoice`: `segmented` chips for the offered networks (`NETWORKS`: Devnet, Mainnet on the platform RPCs), checked by comparing `PgSettings.connection.endpoint` with each chip's URL. A custom URL can only be set through the Connection section's generic Endpoint select, whose "Custom" row opens `CustomSetting` in a modal; nothing remembers it once another network is picked.

`connection.endpoint` is stored by `settings/stored-endpoint.ts`: a platform address as its option key, a custom one as `{ option: "custom", url }`. HOO-2498 is changing how that value reads back (a non-URL falls back to Devnet). This change does not touch that file.

No design source draws a list of saved RPCs. The DS gives the setting row (`block-settings`), the chips and the `field` block ("Custom RPC", `https://`); Spec 07 gives the help line and the URL rule. The rest was decided here and accepted by Design alignment on 4 Nov: chips plus a list, inline form, host only wherever a saved RPC is shown, a toast with Undo on remove.

## Goals / Non-Goals

**Goals:**

- Several named custom RPCs, picked as chips beside Devnet and Mainnet.
- Add, edit and remove inline, with the Spec 07 URL rule.
- No provider key on screen: a saved RPC shows its host.
- Existing profiles on a custom URL keep it, now listed.

**Non-Goals:**

- The 5 s health check and "Use anyway" (Spec 07, SET-16).
- Removing the Connection section's Endpoint select (SET-08).
- Syncing the list to the account or across devices. Tabs agree through the `storage` event.

## Decisions

**An entity, `entities/custom-rpc`.** The saved list is a domain object read by the settings page today and by the sidebar's network row later; an entity is where both can reach it without a feature importing another. Its `model/` holds the URL rule and display (`checkRpcUrl`, `hostOf`, `RPC_NAME_MAX`) and a small store (`PgCustomRpcs`: `list`, `save`, `replace`, `remove`, `restore`, `adopt`, `onDidChange`), with in-source tests. The UI stays in the widget.

**Its own `localStorage` key, `customRpcs`.** A JSON array of `{ name, url }`. Putting it inside `settings` would make it a setting `PgSettings` renders in a generic section, and `toStoredEndpoints` would have to learn a third shape. A few entries cost a few hundred bytes of the origin's budget. A value that cannot be read (storage blocked, not JSON, not a list) reads as an empty list, an invalid or repeated entry is dropped, and a write the browser refuses is a `storage` refusal; each is reported through the logger, never thrown. Names are trimmed and capped on read too, so a hand-edited value cannot give a blank chip.

**The picked RPC is still `connection.endpoint`.** Picking a chip sets the endpoint to the RPC's URL, so every reader of the connection (the provider, the wallet, deploys) works unchanged, and the stored shape stays `{ option: "custom", url }`. The list never stores which one is picked.

**A custom endpoint not in the list is adopted.** On mount, and whenever `connection.endpoint` changes, the section asks the store to list the endpoint, named by its host. That covers profiles from before this change and URLs set through the Connection select or the terminal. The store never lists an address a chip already offers (the configured Devnet and Mainnet, and the public ones `stored-endpoint.ts` reads back as them), nor one that fails the URL rule (Playnet), and refuses to save one of them too ("Already saved as Devnet."). Testnet and Localnet have no chip, so they are listed, under their cluster's name: Spec 07 accepts `http://localhost:8899` as a custom RPC, and the Network row is then the one place to pick it. The store lists the normalised URL (`https://own.rpc.test` becomes `https://own.rpc.test/`), so when that differs from the endpoint the section moves the connection onto the listed spelling: the same address, and the chip is checked.

**URL rule.** `new URL(value)` parses, protocol `https:`, or `http:` with hostname `localhost` or `127.0.0.1`. Stricter than `PgCommon.isUrl`, which HOO-2498 uses for reading back, so anything we save reads back as itself.

**Host only.** Rows, a default name, the toast and the duplicate line use the name (which defaults to `URL.host`); no place outside the edit field renders the full URL.

**Remove with Undo.** Remove drops the entry at once; if it was picked, `connection.endpoint` becomes `DEFAULT_ENDPOINT` (the offered Devnet). The toast's Undo restores the entry at its old index, and re-picks it when it was picked and the network is still that Devnet; a network picked since stays. No confirm dialog.

**Widget pieces.** `BaseNetworkChoice` takes an optional `custom` list and renders its chips after the offered ones. A new `BaseCustomRpcs` draws the list, the "Add custom RPC" button and the form (DS `field`, `input`, `input-group`, `button`), all through props (`onAdd`, `onEdit`, `onRemove`). A new `NetworkSection` connects both to `PgCustomRpcs` and `PgSettings` and sends the three events; `SettingsPage` renders it as the Network section.

## Risks / Trade-offs

- [Two controls still set the endpoint] → the adoption rule keeps the list right whichever is used; SET-08 is in Lead's intake.
- [A URL with a key sits in `localStorage`] → it did already for one custom URL; Spec 07 accepts it ("It stays in this browser"), and nothing sends it to analytics or sync.
- [HOO-2498 lands first and changes the read-back] → our rule is a subset of its rule; rebase only.

## Migration Plan

None beyond adoption: a profile's existing custom endpoint is listed on first read. Rollback leaves an unused `customRpcs` key.

## Open Questions

None open; the gaps went to the designers' batch as "ships as built".
