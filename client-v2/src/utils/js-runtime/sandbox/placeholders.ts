/**
 * Synchronous signing with `pg.wallet.keypair` inside the sandbox.
 *
 * web3.js signs synchronously (`tx.sign(keypair)`), but only the page holds
 * the key and answers over a message. So signing with a sandbox keypair puts
 * a 64-byte placeholder in the signer's slot and asks the page at once. The
 * placeholder is random the first time a signer signs a message and the same
 * every later time in the run, as the real signature is. The real signature replaces the placeholder in the transaction when
 * it arrives, and in the wire bytes when the transaction is sent or simulated
 * (`spliceRpcBody`, called by the RPC bridge), so code that signs first and
 * sends later works unchanged. `sign` and `partialSign` return a promise that
 * resolves once every real signature is in: `await tx.sign(...)` gives a
 * fully signed transaction.
 *
 * Imports web3.js only through `sandbox-signer-provider.ts`, and only after
 * the sandbox's entry has put its `fetch` stand-in in place
 * (`global-fetch.ts`); `patchWeb3` is handed the module it patches.
 */
import { Buffer } from "buffer";

import {
  isSandboxKeypair,
  type SandboxKeypair,
  SIGN_THROUGH_PAGE,
} from "../../wallet/sandbox-signer-provider";

type Web3 = typeof import("@solana/web3.js");

/** Length of an ed25519 signature, and so of a placeholder */
const SIGNATURE_LENGTH = 64;

/** A signature the page has been asked for */
interface Pending {
  /** Resolves with the real signature */
  signature: Promise<Uint8Array>;
  /** Whether the placeholder reached a serialized transaction */
  isSerialized: boolean;
  /** Whether the real signature replaced it in wire bytes */
  isSpliced: boolean;
}

/** Every placeholder handed out in this run, by its hex */
const pending = new Map<string, Pending>();

const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** Whether two byte arrays hold the same bytes */
const isSameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/** Whether a signature slot holds a placeholder still waiting for the page */
const isPlaceholder = (signature: Uint8Array | null | undefined) =>
  !!signature &&
  signature.length === SIGNATURE_LENGTH &&
  pending.has(hexOf(signature));

/**
 * The placeholder already handed out for a signer and message, by
 * `<public key>:<message hex>`: signing the same message as the same signer
 * again gets the same placeholder, as a real signature would be the same.
 * web3.js's `Connection.sendTransaction` relies on that to see a repeated
 * transaction and fetch a fresh blockhash for it.
 */
const placeholderFor = new Map<string, Uint8Array>();

/**
 * Hands out a placeholder for a signature the page is asked for at once, or
 * the one already handed out for the same signer and message, whose request
 * to the page it shares.
 *
 * @param writeBack puts the real signature in the transaction, if its slot
 * still holds the placeholder
 * @returns a function of the signer, then of the bytes to sign
 */
const placeholderWith =
  (writeBack: (placeholder: Uint8Array, signature: Uint8Array) => void) =>
  (signer: SandboxKeypair) =>
  (bytes: Uint8Array) => {
    const request = `${signer.publicKey.toBase58()}:${hexOf(bytes)}`;
    const known = placeholderFor.get(request);
    const entry = known && pending.get(hexOf(known));
    if (known && entry) {
      const placeholder = Uint8Array.from(known);
      // Observed as below; the refusal reaches the code from `entry`
      entry.signature
        .then((real) => writeBack(placeholder, real))
        .catch((error: unknown) => error);
      return placeholder;
    }

    const placeholder = crypto.getRandomValues(
      new Uint8Array(SIGNATURE_LENGTH)
    );
    const created: Pending = {
      signature: signer[SIGN_THROUGH_PAGE](bytes).then((real) => {
        writeBack(placeholder, real);
        return real;
      }),
      isSerialized: false,
      isSpliced: false,
    };
    // Observed here so a `tx.sign` nobody awaits is no unhandled rejection;
    // the refusal still reaches the code where the transaction is sent or
    // awaited, from the same promise
    created.signature.catch((error: unknown) => error);
    pending.set(hexOf(placeholder), created);
    placeholderFor.set(request, Uint8Array.from(placeholder));
    return placeholder;
  };

/** Waits for the real signatures behind every placeholder in `signatures` */
const settledFor = async (
  signatures: Array<Uint8Array | null | undefined>
): Promise<void> => {
  await Promise.all(
    signatures
      .filter(isPlaceholder)
      .map(
        (signature) => pending.get(hexOf(signature as Uint8Array))?.signature
      )
  );
};

/** Marks the placeholders that reached a serialized transaction */
const noteSerialized = (signatures: Array<Uint8Array | null | undefined>) => {
  for (const signature of signatures) {
    if (!signature) continue;
    const entry = pending.get(hexOf(signature));
    if (entry) entry.isSerialized = true;
  }
};

/**
 * Patches the sandbox's own web3.js so a sandbox keypair signs through the
 * page: `Transaction` `sign`, `partialSign` and `serialize`, and
 * `VersionedTransaction` `sign` and `serialize`.
 *
 * @param web3 the sandbox's web3.js module
 */
export const patchWeb3 = (web3: Web3) => {
  type LegacyInternals = {
    signatures: Array<{
      publicKey: InstanceType<Web3["PublicKey"]>;
      signature: Buffer | null;
    }>;
    _addSignature(
      publicKey: InstanceType<Web3["PublicKey"]>,
      signature: Buffer
    ): void;
    _getMessageSignednessErrors(
      signData: Buffer,
      requireAllSignatures: boolean
    ):
      | {
          invalid?: Array<InstanceType<Web3["PublicKey"]>>;
          missing?: Array<InstanceType<Web3["PublicKey"]>>;
        }
      | undefined;
    _serialize(signData: Buffer): Buffer;
    serializeMessage(): Buffer;
  };
  const legacy = web3.Transaction.prototype as unknown as Record<
    string,
    (...args: never[]) => unknown
  >;
  const originalPartialSign = legacy._partialSign;
  const originalSign = legacy.sign;
  const originalPartialSignPublic = legacy.partialSign;
  const originalSerialize = legacy.serialize;

  // `sign` and `partialSign` both end here, with the compiled message
  // eslint-disable-next-line max-params -- web3.js defines the signature
  legacy._partialSign = function (
    this: LegacyInternals,
    message: { serialize(): Buffer },
    ...signers: unknown[]
  ) {
    const real = signers.filter((signer) => !isSandboxKeypair(signer));
    if (real.length) {
      (originalPartialSign as (...args: unknown[]) => void).call(
        this,
        message,
        ...real
      );
    }
    const sandboxed = signers.filter(isSandboxKeypair);
    if (!sandboxed.length) return;

    const bytes = message.serialize();
    for (const signer of sandboxed) {
      const placeholder = placeholderWith((sent, signature) => {
        const slot = this.signatures.find((pair) =>
          pair.publicKey.equals(signer.publicKey)
        );
        if (slot?.signature && isSameBytes(slot.signature, sent)) {
          this._addSignature(signer.publicKey, Buffer.from(signature));
        }
      })(signer)(bytes);
      this._addSignature(signer.publicKey, Buffer.from(placeholder));
    }
  } as never;

  legacy.sign = function (this: LegacyInternals, ...signers: unknown[]) {
    (originalSign as (...args: unknown[]) => void).apply(this, signers);
    return settledFor(this.signatures.map((pair) => pair.signature));
  } as never;

  legacy.partialSign = function (this: LegacyInternals, ...signers: unknown[]) {
    (originalPartialSignPublic as (...args: unknown[]) => void).apply(
      this,
      signers
    );
    return settledFor(this.signatures.map((pair) => pair.signature));
  } as never;

  // Verification skips only the slots that hold a known placeholder; any
  // other invalid or missing signature fails as web3.js reports it
  legacy.serialize = function (
    this: LegacyInternals,
    // eslint-disable-next-line layers/curry-order -- web3.js defines the signature
    config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }
  ) {
    const signatures = this.signatures.map((pair) => pair.signature);
    if (!signatures.some(isPlaceholder)) {
      return (originalSerialize as (...args: unknown[]) => Buffer).call(
        this,
        config
      );
    }

    const signData = this.serializeMessage();
    if (config?.verifySignatures ?? true) {
      const errors = this._getMessageSignednessErrors(
        signData,
        config?.requireAllSignatures ?? true
      );
      const waiting = this.signatures
        .filter((pair) => isPlaceholder(pair.signature))
        .map((pair) => pair.publicKey);
      const invalid = (errors?.invalid ?? []).filter(
        (publicKey) => !waiting.some((key) => key.equals(publicKey))
      );
      if (invalid.length || errors?.missing?.length) {
        // Throws web3.js's own "Signature verification failed" message
        return (originalSerialize as (...args: unknown[]) => Buffer).call(
          this,
          config
        );
      }
    }

    noteSerialized(signatures);
    return this._serialize(signData);
  } as never;

  const versioned = web3.VersionedTransaction.prototype;
  const originalVersionedSign = versioned.sign;
  const originalVersionedSerialize = versioned.serialize;

  versioned.sign = function (
    this: InstanceType<Web3["VersionedTransaction"]>,
    signers: Array<InstanceType<Web3["Keypair"]>>
  ) {
    const real = signers.filter((signer) => !isSandboxKeypair(signer));
    if (real.length) originalVersionedSign.call(this, real);

    const sandboxed = signers.filter(isSandboxKeypair);
    if (sandboxed.length) {
      const bytes = this.message.serialize();
      const signerKeys = this.message.staticAccountKeys.slice(
        0,
        this.message.header.numRequiredSignatures
      );
      for (const signer of sandboxed) {
        const index = signerKeys.findIndex((key) =>
          key.equals(signer.publicKey)
        );
        if (index < 0) {
          throw new Error(
            `Cannot sign with non signer key ${signer.publicKey.toBase58()}`
          );
        }
        this.signatures[index] = placeholderWith((sent, signature) => {
          if (isSameBytes(this.signatures[index], sent)) {
            this.signatures[index] = signature;
          }
        })(signer)(bytes);
      }
    }

    return settledFor(this.signatures) as unknown as void;
  };

  versioned.serialize = function (
    this: InstanceType<Web3["VersionedTransaction"]>
  ) {
    noteSerialized(this.signatures);
    return originalVersionedSerialize.call(this);
  };
};

/** Reads a compact-u16 (shortvec) length: the value and the bytes it took */
const readLength = (bytes: Uint8Array): [number, number] => {
  let value = 0;
  for (let size = 0; size < 3; size++) {
    const byte = bytes[size];
    value |= (byte & 0x7f) << (size * 7);
    if ((byte & 0x80) === 0) return [value, size + 1];
  }
  throw new Error("Malformed transaction: signature count");
};

/**
 * Replaces every placeholder in a wire transaction with its real signature,
 * waiting for the page where it has not answered yet.
 *
 * @param wire the serialized transaction
 * @returns the transaction with real signatures
 */
export const spliceSignatures = async (wire: Uint8Array) => {
  const [count, offset] = readLength(wire);
  const spliced = Uint8Array.from(wire);
  for (let i = 0; i < count; i++) {
    const start = offset + i * SIGNATURE_LENGTH;
    const slot = wire.subarray(start, start + SIGNATURE_LENGTH);
    const entry = pending.get(hexOf(slot));
    if (!entry) continue;
    spliced.set(await entry.signature, start);
    entry.isSpliced = true;
  }
  return spliced;
};

/** The RPC methods whose first parameter is a whole transaction */
const TRANSACTION_METHODS = new Set(["sendTransaction", "simulateTransaction"]);

/** A JSON-RPC request, as web3.js sends it */
interface RpcRequestBody {
  method?: unknown;
  params?: unknown;
}

/**
 * Splices real signatures into the transaction of a `sendTransaction` or
 * `simulateTransaction` request, so every `Connection` in the sandbox sends
 * what the page signed: `sendRawTransaction`, `sendEncodedTransaction`,
 * `sendTransaction` and `simulateTransaction` all end in one of the two.
 *
 * @param request one JSON-RPC request, or a batch of them
 * @returns the request with real signatures
 */
export const spliceRpcBody = async <T extends RpcRequestBody>(
  request: T
): Promise<T> => {
  if (
    typeof request.method !== "string" ||
    !TRANSACTION_METHODS.has(request.method) ||
    !Array.isArray(request.params) ||
    typeof request.params[0] !== "string"
  ) {
    return request;
  }

  const [encoded, config] = request.params as [string, { encoding?: string }];
  // web3.js always sends base64; base58 carries no placeholder of ours
  if (config?.encoding !== "base64") return request;

  const wire = await spliceSignatures(Buffer.from(encoded, "base64"));
  return {
    ...request,
    params: [Buffer.from(wire).toString("base64"), ...request.params.slice(1)],
  };
};

/**
 * How many placeholders reached a serialized transaction and never went out
 * through the RPC bridge: such a transaction carries no valid signature
 */
export const countUnsent = () =>
  Array.from(pending.values()).filter(
    (entry) => entry.isSerialized && !entry.isSpliced
  ).length;
