/**
 * Whole-SOL airdrop covering a deployment's shortfall plus 0.1 SOL fee
 * headroom, capped at the cluster's faucet amount.
 */
export const airdropTopUp = (missingSol: number, faucetCap: number): number =>
  Math.min(faucetCap, Math.ceil(missingSol + 0.1));
