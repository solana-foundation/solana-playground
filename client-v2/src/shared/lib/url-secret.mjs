// @ts-check
// What in a URL reads as a credential: `maskRpcUrl` (entities/cluster) masks
// it on screen, and `scripts/public-env.mjs` fails a production build that
// would publish it. `.mjs` so the build script can import it from Node.

/** A query name a provider puts a key under (`api-key`, `apiKey`, `access_token`…) */
const KEY_NAME = /key|token|secret|auth|pass|sig|credential/i;

/**
 * A value that reads as a token: 16 or more characters a key is written in
 * (letters, digits, `-`, `_`, `.`, `~`, `+`, `=`, `%`, so JWTs and base64
 * too), with a digit, or 24 or more in mixed case. A long slug with a digit
 * counts as well: on screen, hiding a word is cheaper than showing a key, and
 * in a build, failing on a slug is cheaper than publishing a key.
 *
 * @param {string} value one part of a URL, as written in it (not decoded)
 * @returns {boolean}
 */
export const isTokenLike = (value) =>
  /^[\w.~+=%-]{16,}$/.test(value) &&
  (/\d/.test(value) ||
    (value.length >= 24 && /[a-z]/.test(value) && /[A-Z]/.test(value)));

/**
 * A URL's query as written, split into its terms: `[name, value]` for
 * `name=value`, `[term, undefined]` for a bare term, empty terms kept so the
 * query can be written back as it was. Nothing is decoded, so `+` and `%2F`
 * stay the key characters `isTokenLike` reads them as.
 *
 * @param {string} search `URL.search`, `?` included, or empty
 * @returns {Array<[string, string | undefined]>}
 */
export const queryTermsOf = (search) =>
  search
    .slice(1)
    .split("&")
    .map((term) => {
      const at = term.indexOf("=");
      return at < 0
        ? [term, undefined]
        : [term.slice(0, at), term.slice(at + 1)];
    });

/**
 * Whether a query term carries a secret: a non-empty value under a key-like
 * name, a value that reads as a token, or a bare term that does.
 *
 * @param {string} name the term's name, or the bare term
 * @param {string | undefined} value the value after `=`, `undefined` for a bare term
 * @returns {boolean}
 */
export const isSecretQueryTerm = (name, value) =>
  value === undefined
    ? isTokenLike(name)
    : value !== "" && (KEY_NAME.test(name) || isTokenLike(value));
