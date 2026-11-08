import { TerminalLineError } from "@/utils/terminal/line-error";

/**
 * Mainnet deploys are refused in the beta (HOO-2728): `processDeploy` pays
 * from a Playground wallet whose key is kept in the browser, and the beta
 * deploys to devnet, testnet and local networks only. Mainnet stays
 * selectable for reading and Interact; its deploys go through the CLI deploy
 * guide, from the user's own machine.
 */

/** The Deploy stage's line on mainnet */
export const MAINNET_DEPLOY_BLOCKED_LINE =
  "Deploys to mainnet are not available in the beta.";

/** The stage toast's way on, completing "Can't deploy here: …" */
export const MAINNET_DEPLOY_WAY_OUT =
  "on mainnet, deploy from your machine with the Solana CLI or Anchor";

/** The `deploy` command's refusal on mainnet */
export const MAINNET_DEPLOY_BLOCKED = `${MAINNET_DEPLOY_BLOCKED_LINE} Deploy from your own machine with the Solana CLI or Anchor: Deploy stage › Deploy from your machine.`;

/**
 * The refusal of a deploy to mainnet-beta: a rule of the beta, not a failed
 * deploy, so the stage sends no `deploy_failed` for it
 */
export class MainnetDeployRefusedError extends TerminalLineError {
  name = "MainnetDeployRefusedError";

  constructor() {
    super(MAINNET_DEPLOY_BLOCKED);
  }
}

/**
 * Whether a program deploy to `cluster` is refused: the stage's switch to the
 * CLI guide, and the command's hard stop. `null` (not read yet) does not block.
 */
export const isDeployBlocked = (cluster: string | null) =>
  cluster === "mainnet-beta";

/**
 * The `deploy` command's refusal when the endpoint did not say which network
 * it is: a custom RPC that is down or refuses the genesis read could be
 * mainnet, so nothing is sent on a guess
 */
export const DEPLOY_NETWORK_UNREAD =
  "Could not read which network the endpoint serves, so nothing was deployed. Check the RPC in Settings › Network and try again.";
