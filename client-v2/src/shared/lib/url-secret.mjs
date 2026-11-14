// @ts-check
// What in a URL reads as a credential: `maskRpcUrl` (entities/cluster) masks
// it on screen, `reporter/scrub.ts` masks it in reports to Sentry, and
// `scripts/public-env.mjs` fails a production build that would publish it.
// `.mjs` so the build script can import it from Node.

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
 * `text` with each `%XX` escape decoded and `+` read as a space, as a server
 * reads a query name. Never throws on a malformed escape: one that is not two
 * hex digits stays as written.
 *
 * @param {string} text
 * @returns {string}
 */
const percentDecoded = (text) =>
  text
    .replaceAll("+", " ")
    .replace(/%([0-9a-f]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );

/**
 * Whether a query term carries a secret: a non-empty value under a key-like
 * name, as written or decoded (`k%65y` is `key` to the server), a value that
 * reads as a token, or a bare term that does.
 *
 * @param {string} name the term's name, or the bare term, as written
 * @param {string | undefined} value the value after `=`, as written; `undefined` for a bare term
 * @returns {boolean}
 */
export const isSecretQueryTerm = (name, value) =>
  value === undefined
    ? isTokenLike(name)
    : value !== "" &&
      (KEY_NAME.test(name) ||
        KEY_NAME.test(percentDecoded(name)) ||
        isTokenLike(value));

/**
 * `url` with each secret replaced by `mask`: a user name or password, a host
 * label, path segment, bare query term or fragment that reads as a token, and
 * the value of a secret query term. Built from the parsed parts split by hand,
 * so names keep their spelling and `mask` is never percent-encoded; a value
 * that does not parse is `mask` whole.
 *
 * @param {string} mask what stands for each secret
 * @returns {(url: string) => { text: string, masked: boolean }} the text, and whether anything was masked
 */
export const maskUrlWith = (mask) => (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL: any part of it may be the key, so none of it is kept
    return { text: mask, masked: true };
  }
  let masked = false;
  const maskOne = () => {
    masked = true;
    return mask;
  };
  /** @param {string} part */
  const maskToken = (part) => (isTokenLike(part) ? maskOne() : part);

  // A username and a password, either or both, show as one mask
  const auth = parsed.username || parsed.password ? `${maskOne()}@` : "";
  const host =
    parsed.hostname.split(".").map(maskToken).join(".") +
    (parsed.port ? `:${parsed.port}` : "");
  const path = parsed.pathname.split("/").map(maskToken).join("/");
  const query = parsed.search
    ? "?" +
      queryTermsOf(parsed.search)
        .map(([name, value]) => {
          if (value === undefined) return maskToken(name);
          return `${name}=${
            isSecretQueryTerm(name, value) ? maskOne() : value
          }`;
        })
        .join("&")
    : "";
  const fragment = parsed.hash ? `#${maskToken(parsed.hash.slice(1))}` : "";

  return {
    text: `${parsed.protocol}//${auth}${host}${path}${query}${fragment}`,
    masked,
  };
};
