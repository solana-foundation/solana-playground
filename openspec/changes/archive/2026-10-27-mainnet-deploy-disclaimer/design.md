# Design

## Context

See proposal.md for why. `commands/deploy/deploy.ts` pays for the buffer and
the program's extension from a Playground wallet, a keypair held in local
storage: the current one, or, with an external ("standard") wallet connected,
`PgWallet.accounts[0]`, after transferring the cost to it; it hands the buffer
authority to the external wallet, which signs only the final deploy or
upgrade. So the risk the
ticket names does not depend on which wallet is connected, and neither does
the warning. There is no design for the warning in the design system or the
prototype; the system's `Callout` with `variant="warning"` is the note for a
place in a page.

## Goals / Non-Goals

**Goals:** one wording, shown in both places a deploy starts from.

**Non-Goals:** changing how mainnet deploys are paid; remembering a dismissal.

## Decisions

- **Show for every wallet, not only the Playground wallet.** The roadmap's
  scope row for HOO-867 names only the local wallet, but an external wallet's deploy still passes its SOL
  through the local one. Alternative: show only for the Playground wallet;
  rejected, it would hide the warning from exactly the users who think an
  external wallet keeps them safe.
- **One wording, declared once** in `commands/deploy` and imported by the
  stage, so the terminal and the callout cannot drift. The stage stays a
  `Base`/connected pair: `BaseDeploy` decides from its `cluster` prop alone.
- **Inform, never block.** Mainnet deploys from the browser are legitimate;
  the ticket asks to make the risk visible, and a confirm on every deploy
  trains people to click through.
- **Recommend own machine, not an external wallet.** An external wallet does
  not avoid the intermediary today, so suggesting one would mislead.

## Risks / Trade-offs

- [The wording outlives the behaviour] → when the intermediary wallet goes
  away for mainnet, this requirement is modified in the same change.
- [Cluster unknown until the endpoint is read] → no warning while
  `cluster` is `null`; it appears as soon as the cluster resolves. A custom
  endpoint is resolved by its genesis hash, so a custom mainnet RPC that does
  not answer leaves `cluster` `null` and shows no warning.
