/**
 * Keep the hosted keys out of text the agent route relays or logs (HOO-2396).
 *
 * An upstream's error body, a fetch error or a broken stream's message is
 * text the route did not write, and some upstreams quote the key they were
 * given, often with its middle masked (`sk-abc...wxyz`). Removing only the
 * exact key would let such a fragment through, so every run of
 * {@link MIN_RUN} or more characters of a key is removed. A shorter run of a
 * random key gives nothing away and starts to match ordinary words.
 */

/** The shortest run of a key's characters that is removed */
const MIN_RUN = 8;

const MASK = "[redacted]";

/**
 * `text` with every key in `secrets`, and every run of at least eight of its
 * characters, replaced by `[redacted]`. A key shorter than that is removed
 * only whole. Matching is literal, never a pattern built from the key.
 *
 * @param {string} text
 * @param {ReadonlyArray<string | undefined | null>} secrets unset keys are skipped
 * @returns {string}
 */
export const redactSecrets = (text, secrets) => {
  let out = text;
  for (const secret of new Set(secrets)) {
    if (!secret) continue;
    const shortest = Math.min(MIN_RUN, secret.length);
    // Longest runs first, so a whole key is masked once rather than in pieces
    for (let length = secret.length; length >= shortest; length -= 1) {
      for (let start = 0; start + length <= secret.length; start += 1) {
        const run = secret.slice(start, start + length);
        if (out.includes(run)) out = out.split(run).join(MASK);
      }
    }
  }
  return out;
};
