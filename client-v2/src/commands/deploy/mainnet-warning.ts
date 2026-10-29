/**
 * What a mainnet deploy from the browser risks, said once for the terminal
 * and the Deploy stage. `processDeploy` pays for the buffer and the program's
 * extension from a Playground wallet, whose key is in local storage: the
 * current one, or `accounts[0]` when an external wallet is connected, which
 * first transfers the cost to it. Only the final deploy or upgrade is signed
 * by the connected wallet, so the warning holds for every wallet.
 */
export const MAINNET_DEPLOY_WARNING_TITLE = "Mainnet uses real SOL";

/** The words of the body that open the CLI deploy guide on the Deploy stage */
export const MAINNET_DEPLOY_WARNING_GUIDE = "deploy from your own machine";

export const MAINNET_DEPLOY_WARNING_BODY =
  "This deploy pays from the Playground wallet. Its key is kept in this browser, where a malicious script could read it. For a program that matters, deploy from your own machine with the Solana CLI or Anchor.";

/** The callout's title and body as one terminal line */
export const MAINNET_DEPLOY_WARNING = `${MAINNET_DEPLOY_WARNING_TITLE}. ${MAINNET_DEPLOY_WARNING_BODY}`;

/** Whether a deploy to `cluster` gets the warning; `null` is not read yet */
export const warnsOnDeploy = (cluster: string | null) =>
  cluster === "mainnet-beta";
