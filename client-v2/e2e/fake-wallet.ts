import { Keypair } from "@solana/web3.js";
import type { Page } from "@playwright/test";

/**
 * A Wallet Standard wallet injected into the page before the app loads, the
 * way an extension does: it registers on `wallet-standard:register-wallet`
 * and again when the app announces itself with `wallet-standard:app-ready`.
 * It approves every connection, as a wallet that already trusts the site.
 *
 * It signs transactions only when `sign` is set, through a function exposed
 * with `exposeFunction` that signs in node: the secret key never enters the
 * page.
 * The unit tests' wallet is `src/test-utils/fake-wallet.ts`.
 */
export interface PageWallet {
  name: string;
  address: string;
  /** `7Hq5…Xk2P`, as the account row prints it */
  short: string;
  keypair: Keypair;
  /** How many times the page asked `standard:connect` */
  connectCalls(): Promise<number>;
}

export const installFakeWallet = async (
  page: Page,
  opts: {
    name: string;
    keypair?: Keypair;
    sign?: boolean;
    /** Decline that request, as a user pressing Cancel in the wallet does */
    reject?: "connect" | "sign";
    /** Defaults to devnet, mainnet and testnet */
    chains?: string[];
    /** Register into the loaded page, as an extension that injects late does */
    late?: boolean;
  }
): Promise<PageWallet> => {
  const keypair = opts.keypair ?? Keypair.generate();
  const address = keypair.publicKey.toBase58();

  if (opts.sign) {
    const { VersionedTransaction } = await import("@solana/web3.js");
    await page.exposeFunction(
      "__fakeWalletSign",
      (bytes: number[]): number[] => {
        const tx = VersionedTransaction.deserialize(Uint8Array.from(bytes));
        tx.sign([keypair]);
        return Array.from(tx.serialize());
      }
    );
  }

  const inject = ({
    name,
    address,
    publicKey,
    sign,
    chains,
    reject,
  }: {
    name: string;
    address: string;
    publicKey: number[];
    sign: boolean;
    chains: string[];
    reject: string | null;
  }) => {
    type Account = {
      address: string;
      publicKey: Uint8Array;
      chains: string[];
      features: string[];
    };
    const account: Account = {
      address,
      publicKey: Uint8Array.from(publicKey),
      chains,
      features: ["solana:signTransaction"],
    };
    let accounts: Account[] = [];
    const listeners = new Set<(p: { accounts: Account[] }) => void>();
    const state = { connects: 0 };
    (window as unknown as { __fakeWallet: typeof state }).__fakeWallet = state;
    // Looked up per call: the binding is not promised to exist this early
    const signer = (bytes: number[]) =>
      (
        window as unknown as {
          __fakeWalletSign: (bytes: number[]) => Promise<number[]>;
        }
      ).__fakeWalletSign(bytes);

    const wallet = {
      version: "1.0.0",
      name,
      icon: "data:image/svg+xml;base64,PHN2Zy8+",
      chains,
      get accounts() {
        return accounts;
      },
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => {
            state.connects++;
            if (reject === "connect") {
              throw new Error("User rejected the request.");
            }
            accounts = [account];
            listeners.forEach((fn) => fn({ accounts }));
            return { accounts };
          },
        },
        "standard:disconnect": {
          version: "1.0.0",
          disconnect: async () => {
            accounts = [];
            listeners.forEach((fn) => fn({ accounts }));
          },
        },
        "standard:events": {
          version: "1.0.0",
          on: (_e: string, fn: (p: { accounts: Account[] }) => void) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
          },
        },
        // Declared always, as every listed wallet must; without `sign` there
        // is no signer in node, and a signature fails
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
            if (reject === "sign") {
              throw new Error("User rejected the request.");
            }
            if (!sign)
              throw new Error("This fake wallet was set up without signing");
            return Promise.all(
              inputs.map(async ({ transaction }) => ({
                signedTransaction: Uint8Array.from(
                  await signer(Array.from(transaction))
                ),
              }))
            );
          },
        },
      },
    };

    const register = ({ register }: { register: (w: unknown) => () => void }) =>
      register(wallet);
    window.dispatchEvent(
      new CustomEvent("wallet-standard:register-wallet", { detail: register })
    );
    window.addEventListener("wallet-standard:app-ready", (event) =>
      register((event as CustomEvent).detail)
    );
  };
  const args = {
    name: opts.name,
    address,
    publicKey: Array.from(keypair.publicKey.toBytes()),
    sign: !!opts.sign,
    reject: opts.reject ?? null,
    chains: opts.chains ?? [
      "solana:devnet",
      "solana:mainnet",
      "solana:testnet",
    ],
  };
  if (opts.late) await page.evaluate(inject, args);
  else await page.addInitScript(inject, args);

  return {
    name: opts.name,
    address,
    short: `${address.slice(0, 4)}…${address.slice(-4)}`,
    keypair,
    connectCalls: () =>
      page.evaluate(
        () =>
          (window as unknown as { __fakeWallet: { connects: number } })
            .__fakeWallet.connects
      ),
  };
};
