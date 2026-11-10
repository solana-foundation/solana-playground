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
 * The web faucet in three steps, for someone who has never used one: a
 * prefilled link alone loses a newcomer on its sign-in page (Sergey, 10 Nov).
 * `back` is the last step, what to do once the SOL is sent: a card with Try
 * again says to press it, a live balance says it updates by itself.
 */
export const webFaucetSteps = (sol: number, back: string): string[] => [
  "Open the web faucet and sign in with GitHub (an account with a public repo)",
  `Confirm the airdrop. Your address and ${sol} SOL are filled in`,
  back,
];

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
  });
}
