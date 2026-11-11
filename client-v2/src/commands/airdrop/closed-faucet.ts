import { PgConnection } from "../../utils";

/**
 * The airdrop RPCs whose faucet answered closed (`isFaucetClosed`) in this
 * session, by endpoint: the RPC that answered, so localnet, and a custom
 * endpoint that airdrops through itself, are never taken for a closed one. In
 * memory only: a reload asks again, since the faucet may reopen.
 */
const closedEndpoints = new Set<string>();

/** The RPC the next airdrop goes to (`PgConnection.getAirdropConnection`) */
export const getAirdropEndpoint = () =>
  PgConnection.getAirdropConnection(PgConnection.current).rpcEndpoint;

/** Remember that `endpoint`'s faucet answered closed */
export const rememberFaucetClosed = (endpoint: string) => {
  closedEndpoints.add(endpoint);
};

/**
 * Forget `endpoint`'s closed answer: an airdrop through it landed, so its
 * faucet reopened
 */
export const forgetFaucetClosed = (endpoint: string) => {
  closedEndpoints.delete(endpoint);
};

/**
 * Whether `endpoint`'s faucet answered closed in this session: the automatic
 * airdrop and the editor's deploy top-up then point to the web faucet without
 * asking it. The `airdrop` command and a tutorial's funding ask anyway.
 */
export const isFaucetKnownClosed = (endpoint: string) =>
  closedEndpoints.has(endpoint);
