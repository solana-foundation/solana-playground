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

/** The `deploy` command's refusal on mainnet */
export const MAINNET_DEPLOY_BLOCKED = `${MAINNET_DEPLOY_BLOCKED_LINE} Deploy from your own machine with the Solana CLI or Anchor: Deploy stage › Deploy from your machine.`;

/** Whether the stage offers no deploy on `cluster`; `null` is not read yet */
export const blocksDeploy = (cluster: string | null) =>
  cluster === "mainnet-beta";
