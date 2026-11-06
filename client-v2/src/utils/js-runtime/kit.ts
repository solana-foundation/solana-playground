// Runs inside the project-code sandbox (`runtime.html`), so nothing here may
// import the TypeScript compiler, which stays in the page (`prepare-code.ts`).

/**
 * Write BigInt arguments as Node's console does (`2000n`): the browser's
 * `util.format` prints them as `{}`, and Kit returns every amount as one.
 *
 * @param args what the script logged
 * @returns the arguments to format
 */
export const showBigInts = (args: unknown[]) =>
  args.map((arg) => (typeof arg === "bigint" ? `${arg}n` : arg));

/**
 * The message of whatever a script rejected with. Read by shape, not by
 * `instanceof Error`: an error built inside the iframe has the iframe's own
 * `Error`, which the page's does not match.
 *
 * @param reason the rejection's reason: an error, a string, anything
 * @returns its message; its name when the message is empty; else its text
 */
export const reasonMessage = (reason: unknown): string => {
  try {
    const { message, name } =
      (reason as { message?: unknown; name?: unknown } | undefined) ?? {};
    if (typeof message === "string" && message) return message;
    // `new Error()` has an empty message: its name is all there is to say
    if (typeof name === "string" && name && typeof message === "string") {
      return name;
    }
    return String(reason);
  } catch {
    // No `toString` (an object with no prototype), or a getter that throws
    return "a value that cannot be printed";
  }
};

/** What `signerFromFile` says when the current wallet has no keypair to read */
export const SIGNER_NEEDS_PG_WALLET =
  "signerFromFile uses your Playground wallet. Switch to it to run this script.";

/** What `pgSignerFromFileWith` needs from Kit, passed in to keep Kit lazy */
interface KitSignerDeps {
  signer: (signer: any) => (client: any) => any;
}

/** A Kit client plugin: takes the client, resolves to it with more on it */
type KitPlugin = <T extends object>(client: T) => Promise<any>;

/**
 * Replace `@solana/kit-plugin-signer`'s `signerFromFile`, which reads a
 * keypair file from disk, with one that uses the Playground wallet: a docs
 * script's `wallet.json` is the wallet the user already has here. The
 * sandbox never holds the wallet's key, so the signer it is given signs by
 * asking the page (`kitSignerWith`, `wallet/sandbox-signer-provider.ts`).
 *
 * @param deps the plugin's `signer`
 * @param getSigner the current Playground wallet as a Kit signer, or
 * `undefined` when the current wallet is not the Playground wallet
 * @returns a `signerFromFile` that ignores its path
 */
export const pgSignerFromFileWith =
  (deps: KitSignerDeps) =>
  (getSigner: () => object | undefined): ((path: string) => KitPlugin) =>
  // The path the docs pass is their file name; Playground has one wallet
  () =>
  async <T extends object>(client: T) => {
    const kitSigner = getSigner();
    if (!kitSigner) throw new Error(SIGNER_NEEDS_PG_WALLET);
    return deps.signer(kitSigner)(client);
  };
