import {
  isSandboxKeypair,
  type SandboxKeypair,
  signerMethodsWith,
  type SignThroughPage,
} from "../../wallet/sandbox-signer-provider";

/** What a sandbox keypair becomes in Metaplex: a signer the page signs for */
const pageSignerFor = (sign: SignThroughPage) => (keypair: SandboxKeypair) => ({
  publicKey: keypair.publicKey,
  ...signerMethodsWith(sign)(keypair.publicKey),
});

/** How deep in an operation's input a sandbox keypair is looked for */
const SWAP_DEPTH = 4;

/** Whether a value is an object literal, not an instance of a class */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  // eslint-disable-next-line unicorn/no-null -- `getPrototypeOf` returns null for `Object.create(null)`
  return proto === Object.prototype || proto === null;
};

/** Whether a value is Metaplex's `OperationClient` class */
const isOperationClient = (value: unknown) =>
  typeof value === "function" &&
  typeof (value as { prototype?: { execute?: unknown } }).prototype?.execute ===
    "function";

/** Whether `OperationClient.prototype.execute` already swaps sandbox keypairs */
const SWAPS_KEYPAIRS = Symbol("pg.swapsKeypairs");

/**
 * Overrides `@metaplex-foundation/js` for the sandbox, where
 * `pg.wallet.keypair.secretKey` throws. Metaplex reads it twice: its
 * `keypairIdentity` copies the secret key, and every operation tells a
 * keypair from a wallet by whether `secretKey` is set. So `keypairIdentity`
 * of a sandbox keypair is `walletAdapterIdentity` of a signer the page signs
 * for, and every operation's input and options get that signer in place of a
 * sandbox keypair, so it is signed for the way a wallet is, nested in
 * arrays and object literals too (`creators: [{ authority }]`). Keypairs
 * that hold their key, and reading `secretKey` directly, are left as they
 * are.
 *
 * Covers `metaplex.<module>().<operation>(...)`; a transaction builder
 * signed outside `OperationClient.execute` is not covered.
 *
 * @param sign asks the page to sign
 * @returns a function of the imported package
 */
export const metaplexFor =
  (sign: SignThroughPage) => (pkg: Record<string, unknown>) => {
    /**
     * The value with every sandbox keypair in it swapped, through arrays and
     * plain objects (`creators: [{ authority }]`) to `depth` levels; class
     * instances (a `PublicKey`, a `BN`) are left as they are
     */
    const swapWithin =
      (depth: number) =>
      (value: unknown): unknown => {
        if (isSandboxKeypair(value)) return pageSignerFor(sign)(value);
        if (depth === 0) return value;
        if (Array.isArray(value)) return value.map(swapWithin(depth - 1));
        if (!isPlainObject(value)) return value;
        return Object.fromEntries(
          Object.entries(value).map(([key, field]) => [
            key,
            swapWithin(depth - 1)(field),
          ])
        );
      };
    const swapFields = swapWithin(SWAP_DEPTH);

    if (!isOperationClient(pkg.OperationClient)) {
      throw new Error(
        "Playground's Metaplex support does not know this @metaplex-foundation/js: it has no OperationClient"
      );
    }
    const { prototype } = pkg.OperationClient as {
      prototype: {
        execute: (
          operation: { input?: unknown },
          options?: unknown
        ) => Promise<unknown>;
        [SWAPS_KEYPAIRS]?: true;
      };
    };
    if (!prototype[SWAPS_KEYPAIRS]) {
      const execute = prototype.execute;
      prototype.execute = function (
        operation: { input?: unknown },
        // eslint-disable-next-line layers/curry-order -- Metaplex defines the signature
        options = {}
      ) {
        return execute.call(
          this,
          Object.assign(Object.create(operation), {
            input: swapFields(operation.input),
          }),
          swapFields(options)
        );
      };
      prototype[SWAPS_KEYPAIRS] = true;
    }

    const keypairIdentity = pkg.keypairIdentity as (
      keypair: unknown
    ) => unknown;
    const walletAdapterIdentity = pkg.walletAdapterIdentity as (
      wallet: unknown
    ) => unknown;
    return {
      ...pkg,
      keypairIdentity: (keypair: unknown) =>
        isSandboxKeypair(keypair)
          ? walletAdapterIdentity(pageSignerFor(sign)(keypair))
          : keypairIdentity(keypair),
    };
  };

if (import.meta.vitest) {
  const { beforeAll, describe, it, expect } = import.meta.vitest;

  type Signer = import("@metaplex-foundation/js").Signer;
  type SwapTest = import("@metaplex-foundation/js").Operation<
    "pgSwapTest",
    Record<string, unknown>,
    Record<string, unknown>
  >;

  describe("utils/js-runtime/sandbox/metaplex", () => {
    let metaplexJs: Record<string, unknown> &
      typeof import("@metaplex-foundation/js");
    let web3: typeof import("@solana/web3.js");
    let sandboxKeypairWith: typeof import("../../wallet/sandbox-signer-provider").sandboxKeypairWith;
    beforeAll(async () => {
      metaplexJs = (await import(
        "@metaplex-foundation/js"
      )) as typeof metaplexJs;
      web3 = await import("@solana/web3.js");
      ({ sandboxKeypairWith } = await import(
        "../../wallet/sandbox-signer-provider"
      ));
    });

    /** A page that records what it is asked to sign */
    const recordingPage = () => {
      const asked: string[] = [];
      const sign: SignThroughPage = (publicKey) => (kind) => async () => {
        asked.push(`${kind} ${publicKey.toBase58()}`);
        return new Uint8Array(64);
      };
      return { sign, asked };
    };

    it("keypairIdentity of a sandbox keypair is a wallet identity the page signs for", async () => {
      const { sign, asked } = recordingPage();
      const keypair = sandboxKeypairWith(sign)(
        web3.Keypair.generate().publicKey
      );
      const { keypairIdentity, Metaplex } = metaplexFor(sign)(
        metaplexJs
      ) as typeof metaplexJs;

      const metaplex = new Metaplex(
        new web3.Connection("http://localhost:8899")
      ).use(keypairIdentity(keypair));

      const identity = metaplex.identity();
      expect(identity.publicKey.equals(keypair.publicKey)).toBe(true);
      expect(identity.hasSecretKey()).toBe(false);
      await identity.signMessage(new Uint8Array([1]));
      expect(asked).toEqual([`message ${keypair.publicKey.toBase58()}`]);
    });

    it("keypairIdentity of a real keypair is Metaplex's own", () => {
      const { sign } = recordingPage();
      const keypair = web3.Keypair.generate();
      const { keypairIdentity, Metaplex } = metaplexFor(sign)(
        metaplexJs
      ) as typeof metaplexJs;

      const metaplex = new Metaplex(
        new web3.Connection("http://localhost:8899")
      ).use(keypairIdentity(keypair));

      expect(metaplex.identity().hasSecretKey()).toBe(true);
    });

    it("hands an operation a page signer in place of a sandbox keypair, and leaves the rest", async () => {
      const { sign } = recordingPage();
      const keypair = sandboxKeypairWith(sign)(
        web3.Keypair.generate().publicKey
      );
      const real = web3.Keypair.generate();
      const { Metaplex, useOperation, isIdentitySigner, isKeypairSigner } =
        metaplexFor(sign)(metaplexJs) as typeof metaplexJs;
      const metaplex = new Metaplex(
        new web3.Connection("http://localhost:8899")
      );
      const operation = useOperation<SwapTest>("pgSwapTest");
      metaplex.operations().register(operation, {
        handle: async (op) => op.input,
      });

      const input = await metaplex.operations().execute(
        operation({
          authority: keypair,
          creators: [
            { address: keypair.publicKey, share: 100, authority: keypair },
          ],
          other: real,
          amount: 1,
        })
      );

      const { authority, creators, other, amount } = input as {
        authority: Signer;
        creators: Array<{ authority: Signer; share: number }>;
        other: Signer;
        amount: number;
      };
      expect(isIdentitySigner(authority)).toBe(true);
      expect(isIdentitySigner(creators[0].authority)).toBe(true);
      expect(creators[0].share).toBe(100);
      expect(isKeypairSigner(other)).toBe(true);
      expect(amount).toBe(1);
    });
  });
}
