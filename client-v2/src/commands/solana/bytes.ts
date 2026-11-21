import type { ReadonlyUint8Array } from "@solana/kit";

/**
 * The bytes kit's codecs return as a `Uint8Array`. kit types them as
 * `ReadonlyUint8Array`, which `Omit` leaves without `length` and the
 * iterator; the value is a plain `Uint8Array`.
 *
 * @param bytes what a kit codec returned
 * @returns the same bytes, typed as what they are
 */
export const toBytes = (bytes: ReadonlyUint8Array) => bytes as Uint8Array;
