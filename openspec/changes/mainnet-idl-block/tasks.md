## 1. Refuse mainnet IDL writes (HOO-2737)

- [x] 1.1 Refuse `anchor idl` writes on mainnet with the deploy's check, hold the network while one runs (Settings and the Deploy stage's link). Verify: `yarn vitest run src/commands/anchor src/commands/deploy src/widgets/settings-page src/views/flow/stages`, `yarn run check`.
