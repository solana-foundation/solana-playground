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
 * Each stretch of the text made of such runs becomes one `[redacted]`, so a
 * run of one key cannot split another and leave its first characters
 * (a value's `%20` and `+` encodings share a long run). The time is linear in
 * the text and the keys: trying every run of a long token against a large
 * error page blocked the server for seconds.
 *
 * @param {ReadonlyArray<string | undefined | null>} secrets unset keys are skipped
 * @returns {(text: string) => string}
 */
export const redactSecretsWith = (secrets) => {
  const keys = [...new Set(secrets)].filter(
    /** @returns {secret is string} */ (secret) => !!secret
  );
  const short = keys.filter((key) => key.length < MIN_RUN);
  const runs = substringsOf(keys.filter((key) => key.length >= MIN_RUN));
  return (text) => {
    /** @type {Array<[number, number]>} spans `[start, end)` to mask */
    const spans = runs.spansOfAtLeast(MIN_RUN, text);
    for (const key of short) {
      for (
        let at = text.indexOf(key);
        at !== -1;
        at = text.indexOf(key, at + 1)
      ) {
        spans.push([at, at + key.length]);
      }
    }
    return mask(text, spans);
  };
};

/**
 * `text` with each union of overlapping or touching `spans` replaced by one
 * {@link MASK}.
 *
 * @param {string} text
 * @param {Array<[number, number]>} spans
 */
const mask = (text, spans) => {
  if (spans.length === 0) return text;
  spans.sort((a, b) => a[0] - b[0]);
  let out = "";
  let kept = 0;
  let [start, end] = spans[0];
  for (const [from, to] of spans.slice(1)) {
    if (from <= end) {
      end = Math.max(end, to);
      continue;
    }
    out += text.slice(kept, start) + MASK;
    kept = end;
    [start, end] = [from, to];
  }
  return out + text.slice(kept, start) + MASK + text.slice(end);
};

/**
 * A suffix automaton of `keys`: it recognises every substring of any of them,
 * so one pass over a text finds, at each position, the longest stretch ending
 * there that is part of a key.
 *
 * @param {ReadonlyArray<string>} keys
 */
const substringsOf = (keys) => {
  /** @type {Array<Map<string, number>>} */
  const next = [new Map()];
  const link = [-1];
  const len = [0];
  /** @param {number} from @param {number} length */
  const clone = (from, length) => {
    next.push(new Map(next[from]));
    link.push(link[from]);
    len.push(length);
    return next.length - 1;
  };

  for (const key of keys) {
    let last = 0;
    for (const c of key.split("")) {
      const existing = next[last].get(c);
      if (existing !== undefined) {
        // The key so far is already known (another key shares it)
        if (len[existing] === len[last] + 1) {
          last = existing;
        } else {
          const copy = clone(existing, len[last] + 1);
          for (
            let p = last;
            p !== -1 && next[p].get(c) === existing;
            p = link[p]
          ) {
            next[p].set(c, copy);
          }
          link[existing] = copy;
          last = copy;
        }
        continue;
      }
      next.push(new Map());
      link.push(0);
      len.push(len[last] + 1);
      const cur = next.length - 1;
      let p = last;
      for (; p !== -1 && !next[p].has(c); p = link[p]) next[p].set(c, cur);
      if (p !== -1) {
        const q = /** @type {number} */ (next[p].get(c));
        if (len[p] + 1 === len[q]) {
          link[cur] = q;
        } else {
          const copy = clone(q, len[p] + 1);
          for (let r = p; r !== -1 && next[r].get(c) === q; r = link[r]) {
            next[r].set(c, copy);
          }
          link[q] = copy;
          link[cur] = copy;
        }
      }
      last = cur;
    }
  }

  return {
    /**
     * Every stretch of `text`, `[start, end)`, at least `min` characters long
     * and part of a key. Their starts never decrease, so touching ones are
     * merged as they come.
     *
     * @param {number} min
     * @param {string} text
     * @returns {Array<[number, number]>}
     */
    spansOfAtLeast: (min, text) => {
      /** @type {Array<[number, number]>} */
      const spans = [];
      let state = 0;
      let matched = 0;
      for (let at = 0; at < text.length; at += 1) {
        const c = text[at];
        while (state !== 0 && !next[state].has(c)) {
          state = link[state];
          matched = len[state];
        }
        const to = next[state].get(c);
        if (to === undefined) {
          matched = 0;
          continue;
        }
        state = to;
        matched += 1;
        if (matched < min) continue;
        const start = at + 1 - matched;
        const open = spans[spans.length - 1];
        if (open && start <= open[1]) open[1] = at + 1;
        else spans.push([start, at + 1]);
      }
      return spans;
    },
  };
};
