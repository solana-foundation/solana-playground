## Why

The beta refuses paid mainnet sends from the Playground wallet, whose key
lives in the browser (HOO-2728, `mainnet-deploy-block`). That change refused
program deploys only. The terminal's `anchor idl` writes send the same kind of
paid mainnet transactions from the same wallet. Ticket: HOO-2737.

## What Changes

- The `anchor` command refuses an `idl` write (`init`, `upgrade`,
  `write-buffer`, `set-buffer`, `close`, `set-authority`, `erase-authority`, and
  any subcommand a later CLI adds) when the endpoint the CLI sends to is
  mainnet-beta, with the same check the deploy uses: the cluster is read from
  the endpoint, a custom RPC by its genesis hash, and an endpoint that does not
  say its network is refused. Reads (`fetch`, `authority`, help) run anywhere.
- While an `idl` write runs, a network switch the user asks for (Settings,
  the Deploy stage's "Show <network>" link) is refused with a toast, as during
  a deploy: the CLI reads the endpoint again at each step.
- The Deploy and Interact stages' "Upload IDL" button is unchanged: it loads
  an IDL file into this browser and writes nothing on chain.
- No telemetry event is added, renamed or removed.

## Capabilities

### Modified Capabilities

- `mainnet-deploy-warning`: adds the refusal of `anchor idl` writes on
  mainnet and the network hold while one runs.

## Impact

`client-v2/src/commands/anchor`, `commands/deploy/{check-not-mainnet,mainnet-block}.ts`,
`utils/global.ts` (`isIdlWriting`), `widgets/settings-page` (network hold,
`pickNetwork`), `views/flow/stages/Deploy.tsx`.
