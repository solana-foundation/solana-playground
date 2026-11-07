## Why

Settings › Network refused a custom RPC whose URL a chip or a saved RPC already had: `https://api.devnet.solana.com` gave "Already saved as Devnet." Sergey had Devnet on an internal RPC and wanted the public Devnet beside it, and could not add it (call of 7 Nov, [HOO-2690](https://linear.app/solana-fndn/issue/HOO-2690)). Even once saved, the public URL was stored under the `devnet` key and read back after a reload as Devnet's own RPC.

## What Changes

- A custom RPC may use any URL that passes the URL rule, a chip's or another saved RPC's included. Only an entry with both the name and the URL of a chip or a saved RPC is refused, with "Already saved as {name}."
- An entry is named by its name and its URL together: edit and remove act on that pair.
- When chips share the URL in use, one is checked: the one picked or saved last, else the first listing it. Removing one of them leaves the network where it is.
- The connection's endpoint is stored under an option's key only when the key reads back as that same address, so a picked public URL stays itself after a reload.

## Capabilities

### Modified Capabilities

- `client-v2-custom-rpcs`: the URL rule's duplicate check; a new requirement for chips that share a URL.

## Impact

`entities/custom-rpc` (store), `widgets/settings-page` (chips, list, section, save flow), `settings/stored-endpoint.ts`. No storage migration: stored lists and settings read as before.
