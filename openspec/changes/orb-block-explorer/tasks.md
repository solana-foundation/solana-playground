# Tasks

## 1. Orb

- [x] 1.1 Add `client-v2/src/block-explorers/orb.ts` per the
      `client-v2-block-explorers` spec; the settings list it through
      `PgBlockExplorer.all`. Verify with `src/utils/block-explorer.test.ts`:
      Orb's address and transaction links on mainnet, devnet, testnet and the
      selected network, and `opens` false on localnet, playnet and a custom
      RPC (HOO-2759; no dependencies)
