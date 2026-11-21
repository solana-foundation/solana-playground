import type { ReadonlyUint8Array } from "@solana/kit";

/**
 * The bytes kit's codecs return as a `Uint8Array`. kit types them as
 * `ReadonlyUint8Array`, a view without `Uint8Array`'s mutating methods
 * (`set`, `fill`, `sort`, …), which is therefore not assignable to
 * `Uint8Array`, the type `slice`, `Uint8Array.from` and web3.js take; the
 * value is a plain `Uint8Array`.
 *
 * @param bytes what a kit codec returned
 * @returns the same bytes, typed as what they are
 */
export const toBytes = (bytes: ReadonlyUint8Array) => bytes as Uint8Array;
