/**
 * A v4 UUID.
 *
 * `crypto.randomUUID` is not used unconditionally: browserslist still claims
 * Safari 14, which has `getRandomValues` but not `randomUUID`, and this runs
 * on every chat message.
 *
 * Ids are minted on the client so an append is safely repeatable -- the same
 * message dumped twice, or from three devices, collapses on the primary key
 * instead of duplicating.
 */
export const uuid = (): string => {
  // Held in a local so the `in` check below narrows the property, not the
  // global itself -- narrowing `crypto` leaves it `never` on the fallback path
  const c: Crypto = crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();

  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  // Version 4, variant 10xx
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
};
