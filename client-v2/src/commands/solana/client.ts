import {
  type Commitment,
  createSolanaRpc,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";

/** What a `solana` subcommand reads a cluster through: the RPC, the URL it was made from, and the commitment its reads wait for */
export interface SolanaClient {
  readonly url: string;
  readonly commitment: Commitment;
  readonly rpc: Rpc<SolanaRpcApi>;
}

/** Whether a string is one of the three commitments the app's setting holds */
const isCommitment = (value: string): value is Commitment =>
  value === "processed" || value === "confirmed" || value === "finalized";

/**
 * The client for a URL.
 *
 * @param commitment the app's commitment setting
 * @returns a function from the RPC URL to its client
 */
export const createClientWith = (commitment: string) => (url: string) => ({
  url,
  commitment: isCommitment(commitment) ? commitment : "confirmed",
  rpc: createSolanaRpc(url),
});
