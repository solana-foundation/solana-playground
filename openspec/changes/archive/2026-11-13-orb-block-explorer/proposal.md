# Proposal

## Why

Cat McGee asked for Orb (orbmarkets.io) as a block explorer on 9 Nov, and
Sergey Prokhorov asked again on 12 Nov. The settings offer Solana Explorer and
Solscan only (HOO-2700 dropped Solana FM and said Orb comes only when asked).
HOO-2759 adds it.

## What Changes

- New explorer `Orb` at `https://orbmarkets.io`, beside Solana Explorer and
  Solscan, in the "Block explorer" setting. Solana Explorer stays the default.
- Its links: `/address/<key>` and `/tx/<signature>`; mainnet takes no
  parameter, devnet and testnet take `?cluster=devnet` / `?cluster=testnet`.
  Checked on the live site, 13 Nov 2026.
- Orb has no page for a local validator or a custom RPC URL, so on those it
  reports that it cannot open the network, as Solscan does on localnet; the
  fund dialog and the Deploy stage, which ask, then show no Orb link.
- Each explorer gains `getIdlUrl`. The settings page's "Program IDL" link
  appended `/idl` after the whole address URL, so off mainnet it landed after
  `?cluster=` and on Orb it named a tab Orb does not have (`anchor-idl`).
- The tutorial's Explorer links are unchanged: `tutorial-runs` pins them to
  Solana Explorer on devnet, whatever the setting names.
- Telemetry: none added, renamed or removed.

## Capabilities

### New Capabilities

- `client-v2-block-explorers`: which block explorers the settings offer, which
  one is the default, and how each one's links open a network.

## Impact

- Code: `client-v2/src/block-explorers/` (Orb, the list order),
  `utils/block-explorer.ts` (`getIdlUrl`), and the settings page's "Program
  IDL" link.
- Out of scope: the tutorial's Explorer links, which `tutorial-runs` pins to
  Solana Explorer on devnet; and the places that build an explorer link
  without asking `opens()` (the transaction toast, the wallet's transaction
  list and a few others), which open an empty mainnet page on a local
  validator for Solscan already and now for Orb too. That predates this
  change and went to Intake.
