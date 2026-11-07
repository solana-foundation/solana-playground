## 1. Refuse mainnet deploys (HOO-2728)

- [x] 1.1 Refuse program deploys to mainnet in the command and the Deploy stage, Settings line, e2e — [plan](plans/1.1-refuse-mainnet-deploys.md). Verify: `yarn vitest run src/commands/deploy src/views/flow/stages src/widgets/settings-page src/features/cli-deploy`, `e2e/mainnet-deploy-warning.e2e.spec.ts`, `yarn run check`.
