/** A signature's confirmation, as `getSignatureStatuses` reports it for a signature the cluster knows */
export interface SignatureStatus {
  readonly confirmationStatus?: string;
  /** The transaction's error; absent when it did not fail */
  readonly err?: unknown;
}

/**
 * The status a `getSignatureStatuses` entry holds, with the `null`s of the
 * wire turned into absent fields.
 *
 * @param entry an item of `getSignatureStatuses`' `value`: `null` for a signature the cluster does not know
 * @returns the status, or `undefined` for an unknown signature
 */
export const toSignatureStatus = (
  entry:
    | {
        readonly confirmationStatus?: string | null;
        readonly err?: unknown;
      }
    | null
    | undefined
): SignatureStatus | undefined =>
  entry
    ? {
        confirmationStatus: entry.confirmationStatus ?? undefined,
        err: entry.err ?? undefined,
      }
    : undefined;
