/** The web faucet, until Playground has a faucet of its own */
export const FAUCET_URL = "https://faucet.solana.com";

/** The most SOL the faucet gives on devnet in one request */
export const DEVNET_FAUCET_SOL = 5;

/**
 * The amounts the faucet's form offers; it ignores any other in a link, which
 * then opens with the amount unset. Read from faucet.solana.com's page script
 * in Nov 2026, like the clusters below.
 */
const FAUCET_AMOUNTS: readonly number[] = [0.5, 1, 2.5, 5];

/** The clusters the faucet's form has; it ignores any other in a link */
const FAUCET_CLUSTERS: readonly string[] = ["devnet", "testnet"];

/** Whether the faucet serves the cluster; a local validator has none */
export const isFaucetCluster = (cluster: string): boolean =>
  FAUCET_CLUSTERS.includes(cluster);

export interface FaucetLinkFill {
  walletAddress?: string;
  /** In SOL */
  amount?: number;
  cluster?: string;
}

/**
 * A link to the faucet with its form filled in. The faucet reads
 * `walletAddress`, `amount` and `cluster` from the query on load and drops a
 * value its form does not offer, so only those it takes are written.
 */
export const faucetLink = ({
  walletAddress,
  amount,
  cluster,
}: FaucetLinkFill): string => {
  const query = new URLSearchParams();
  if (walletAddress) query.set("walletAddress", walletAddress);
  if (amount !== undefined && FAUCET_AMOUNTS.includes(amount)) {
    query.set("amount", String(amount));
  }
  if (cluster && isFaucetCluster(cluster)) {
    query.set("cluster", cluster);
  }
  const search = query.toString();
  return search ? `${FAUCET_URL}/?${search}` : FAUCET_URL;
};

/** {@link faucetLink} for a wallet, the bare faucet without one */
const linkWith =
  (fill: Pick<FaucetLinkFill, "amount">) =>
  (cluster: string) =>
  (address: string | undefined): string =>
    address
      ? faucetLink({ walletAddress: address, cluster, ...fill })
      : FAUCET_URL;

/** The faucet with the wallet's address filled in; the bare site without one */
export const faucetUrlFor = linkWith({});

/** {@link faucetUrlFor}, also asking for `sol` */
export const faucetUrlWith = (sol: number) => linkWith({ amount: sol });

/**
 * A closed RPC faucet's answer to `requestAirdrop`, as web3.js reports it:
 * "410 Gone: <body>" for the HTTP status (or "410 : <body>" over HTTP/2), and
 * "airdrop to <address> failed: <message>" for a JSON-RPC error carried by a
 * 200, whose code web3.js keeps out of the message, so only the words tell
 * there. Since 3 Nov devnet
 * answers `{"code": 410, "message": "The RPC faucet is closed on this
 * cluster. Request test SOL at https://faucet.solana.com"}`.
 */
const FAUCET_CLOSED = /^410\b|"code"\s*:\s*410\b|faucet is closed/i;

/**
 * Whether a refused airdrop's message says the cluster's RPC faucet is
 * closed: asking it again will not help until it reopens, the web faucet will
 */
export const isFaucetClosed = (message: string): boolean =>
  FAUCET_CLOSED.test(message);

/**
 * The line the terminal and the deploy's funding card show once a closed RPC
 * faucet refused an airdrop: the web faucet with the wallet's address filled
 * in, in place of the RPC's JSON
 */
export const faucetClosedLineFor =
  (cluster: string) =>
  (address: string | undefined): string =>
    `The ${cluster} RPC faucet is closed. Request test SOL at ${faucetUrlFor(
      cluster
    )(address)}`;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

  describe("shared/lib/faucet", () => {
    it("is the bare faucet with nothing to fill in", () => {
      expect(faucetLink({})).toBe(FAUCET_URL);
    });

    it("fills in the wallet, the amount and the cluster the faucet takes", () => {
      const url = new URL(
        faucetLink({ walletAddress: WALLET, amount: 5, cluster: "devnet" })
      );
      expect(url.origin).toBe(FAUCET_URL);
      expect(url.searchParams.get("walletAddress")).toBe(WALLET);
      expect(url.searchParams.get("amount")).toBe("5");
      expect(url.searchParams.get("cluster")).toBe("devnet");
    });

    it("leaves out an amount the faucet does not offer", () => {
      const url = new URL(faucetLink({ walletAddress: WALLET, amount: 3 }));
      expect(url.searchParams.has("amount")).toBe(false);
      expect(url.searchParams.get("walletAddress")).toBe(WALLET);
    });

    it("leaves out a cluster the faucet has no form for", () => {
      const url = new URL(
        faucetLink({ walletAddress: WALLET, cluster: "localnet" })
      );
      expect(url.searchParams.has("cluster")).toBe(false);
    });

    it("takes testnet", () => {
      const url = new URL(faucetLink({ cluster: "testnet", amount: 1 }));
      expect(url.searchParams.get("cluster")).toBe("testnet");
      expect(url.searchParams.get("amount")).toBe("1");
    });

    it("is the bare faucet for a wallet link with no address", () => {
      expect(faucetUrlWith(DEVNET_FAUCET_SOL)("devnet")(undefined)).toBe(
        FAUCET_URL
      );
    });

    /** api.devnet.solana.com's answer to `requestAirdrop`, 11 Nov 2026 */
    const CLOSED_BODY =
      '{"jsonrpc":"2.0","error":{"code": 410, "message":"The RPC faucet is closed on this cluster. Request test SOL at https://faucet.solana.com"}, "id": "6f1c3a52-1d4b-4429-9a29-2c3e2b7d4291"}';

    it.each([
      ["the HTTP 410 web3.js reports", `410 Gone: ${CLOSED_BODY}`],
      ["the HTTP/2 410, with no status text", `410 : ${CLOSED_BODY}`],
      [
        "the JSON-RPC error of a 200",
        "airdrop to Wa11et failed: The RPC faucet is closed on this cluster. Request test SOL at https://faucet.solana.com",
      ],
    ])("reads %s as a closed faucet", (_, message) => {
      expect(isFaucetClosed(message)).toBe(true);
    });

    it("reads a limit or any other failure as something else", () => {
      expect(isFaucetClosed("429 Too Many Requests: rate limited")).toBe(false);
      // Devnet's own answer at its limit sits closest to the closed one
      expect(
        isFaucetClosed(
          `429 Too Many Requests: {"jsonrpc":"2.0","error":{"code": 429, "message":"You've either reached your airdrop limit today or the airdrop faucet has run dry. Please visit https://faucet.solana.com for alternate sources of test SOL"}, "id": "1"}`
        )
      ).toBe(false);
      expect(isFaucetClosed("fetch failed")).toBe(false);
      expect(isFaucetClosed("slot 4100 is not available")).toBe(false);
    });

    it("says the faucet is closed in one line, with the web faucet filled in", () => {
      expect(faucetClosedLineFor("devnet")(WALLET)).toBe(
        `The devnet RPC faucet is closed. Request test SOL at https://faucet.solana.com/?walletAddress=${WALLET}&cluster=devnet`
      );
    });
  });
}
