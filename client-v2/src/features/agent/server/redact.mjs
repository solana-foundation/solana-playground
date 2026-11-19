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
 * @param {ReadonlyArray<string | undefined | null>} secrets unset keys are skipped
 * @returns {(text: string) => string}
 */
export const redactSecretsWith = (secrets) => {
  const keys = [...new Set(secrets)].filter(
    /** @returns {secret is string} */ (secret) => !!secret
  );
  const longest = Math.max(0, ...keys.map((key) => key.length));
  return (text) => {
    let out = text;
    // Runs of all keys together, longest first. Two keys can share a long run
    // (a value's `%20` and `+` encodings), and masking a run of one before the
    // whole of the other would split the other, leaving its first characters
    // too short to match. Generated on the fly: a long token has many runs.
    for (let length = longest; length >= 1; length -= 1) {
      for (const key of keys) {
        if (length > key.length || length < Math.min(MIN_RUN, key.length)) {
          continue;
        }
        for (let at = 0; at + length <= key.length; at += 1) {
          const run = key.slice(at, at + length);
          if (out.includes(run)) out = out.split(run).join(MASK);
        }
      }
    }
    return out;
  };
};
