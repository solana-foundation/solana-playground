// @ts-check
// What in a URL reads as a credential: `maskRpcUrl` (entities/cluster) masks
// it on screen, `reporter/scrub.ts` masks it in reports to Sentry, and
// `scripts/public-env.mjs` fails a production build that would publish it.
// `.mjs` so the build script can import it from Node.

/** A query name a provider puts a key under (`api-key`, `apiKey`, `access_token`…) */
const KEY_NAME = /key|token|secret|auth|pass|sig|credential/i;

/** A maximal run of the characters a key is written in: letters, digits, `-`, `_`, `.`, `~`, `+`, `=`, `%`, so JWTs and base64 too */
const TOKEN_RUN = /[\w.~+=%-]+/g;

/**
 * Whether one {@link TOKEN_RUN} is 16 or more characters with a digit, or 24 or more in mixed case.
 * A slug with a digit counts too: hiding a word costs less than showing or publishing a key.
 *
 * @param {string} run
 * @returns {boolean}
 */
const isTokenRun = (run) =>
  run.length >= 16 &&
  (/\d/.test(run) ||
    (run.length >= 24 && /[a-z]/.test(run) && /[A-Z]/.test(run)));

/**
 * Whether any run of key characters in `value` reads as a token, each run
 * judged on its own, so `<key>,then`, `<key>;v=1` and `<key>:8899` all do.
 *
 * @param {string} value one part of a URL, as written in it (not decoded)
 * @returns {boolean}
 */
export const isTokenLike = (value) =>
  (value.match(TOKEN_RUN) ?? []).some(isTokenRun);

/**
 * `part` with each run of key characters that reads as a token replaced by
 * `mask`; the characters between runs stay as written.
 *
 * @param {string} mask what stands for each secret
 * @returns {(part: string) => string}
 */
const maskTokensWith = (mask) => (part) =>
  part.replace(TOKEN_RUN, (run) => (isTokenRun(run) ? mask : run));

/** CRA's content-hashed build output (`static/js/main.3f2a1b4c.js`), its name part captured: a stack frame needs the file name to find its source map */
const APP_ASSET =
  /\/static\/(?:js|css|media)\/([\w-]+)\.[0-9a-f]{8,32}(?:\.chunk)?\.[a-z0-9]+$/;

/** The `:line` or `:line:col` a stack trace writes after a file name */
const LINE_COLUMN = /:\d+:\d+$|:\d+$/;

/**
 * Whether `pathname` ends in a file name of {@link APP_ASSET}'s shape, a {@link LINE_COLUMN} after it allowed,
 * whose name part is not itself token-like, as CRA's `main`, `812` and `logo` are.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
const isAppAsset = (pathname) => {
  const name = APP_ASSET.exec(pathname.replace(LINE_COLUMN, ""))?.[1];
  return name !== undefined && !isTokenLike(name);
};

/**
 * `hostname` with each token in a label replaced by `mask`; a `:port` stays.
 *
 * @param {string} mask what stands for each secret
 * @returns {(hostname: string) => string}
 */
export const maskHostWith = (mask) => {
  const maskTokens = maskTokensWith(mask);
  // Split first: `.` is a key character, so one run would span every label
  return (hostname) => hostname.split(".").map(maskTokens).join(".");
};

/**
 * A URL's query as written, split into its terms: `[name, value]` for
 * `name=value`, `[term, undefined]` for a bare term, empty terms kept so the
 * query can be written back as it was. A term with nothing but `=` after its
 * first `=` is a bare term too, so the padding of base64 stays in the run
 * `isTokenLike` judges. Nothing is decoded, so `+` and `%2F` stay the key
 * characters `isTokenLike` reads them as.
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
      return at < 0 || /^=*$/.test(term.slice(at + 1))
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
 * Whether a query term holds a non-empty value under a key-like name, as
 * written or decoded (`k%65y` is `key` to the server).
 *
 * @param {string} name the term's name, as written
 * @param {string} value the value after `=`, as written
 * @returns {boolean}
 */
const isKeyNamedTerm = (name, value) =>
  value !== "" && (KEY_NAME.test(name) || KEY_NAME.test(percentDecoded(name)));

/**
 * Whether a query term carries a secret: a value under a key-like name
 * ({@link isKeyNamedTerm}), a value that reads as a token, or a bare term
 * that does.
 *
 * @param {string} name the term's name, or the bare term, as written
 * @param {string | undefined} value the value after `=`, as written; `undefined` for a bare term
 * @returns {boolean}
 */
export const isSecretQueryTerm = (name, value) =>
  value === undefined
    ? isTokenLike(name)
    : isKeyNamedTerm(name, value) || isTokenLike(value);

/**
 * A URL's query, without its `?`, with the whole value of a term
 * {@link isKeyNamedTerm} accepts, and each token in another value or a bare
 * term, replaced by `mask`.
 *
 * @param {string} mask what stands for each secret
 * @returns {(query: string) => string}
 */
export const maskQueryWith = (mask) => {
  const maskTokens = maskTokensWith(mask);
  return (query) =>
    queryTermsOf(`?${query}`)
      .map(([name, value]) => {
        if (value === undefined) return maskTokens(name);
        // The name is never masked: a provider puts its key in a value or a bare term, and `maxSupportedTransactionVersion` would read as a token
        return `${name}=${
          isKeyNamedTerm(name, value) ? mask : maskTokens(value)
        }`;
      })
      .join("&");
};

/**
 * A URL's fragment, without its `#`, with each token in it replaced by `mask`.
 *
 * @param {string} mask what stands for each secret
 * @returns {(fragment: string) => string}
 */
export const maskFragmentWith = maskTokensWith;

/**
 * A URL's path with each token in a segment replaced by `mask`, an {@link isAppAsset} file name kept.
 *
 * @param {string} mask what stands for each secret
 * @returns {(pathname: string) => string}
 */
export const maskPathWith = (mask) => {
  const maskTokens = maskTokensWith(mask);
  return (pathname) => {
    const segments = pathname.split("/");
    const assetAt = isAppAsset(pathname) ? segments.length - 1 : -1;
    return segments
      .map((segment, i) => (i === assetAt ? segment : maskTokens(segment)))
      .join("/");
  };
};

/**
 * A host label the URL parser keeps as written and `url` does not hold. It stands for a mask already in `url`
 * while the URL is parsed: the parser refuses a host label `[redacted]` and gives `••••` back encoded.
 *
 * @param {string} url
 * @returns {string}
 */
const standInFor = (url) => {
  const lower = url.toLowerCase();
  let standIn = "masked";
  while (lower.includes(standIn)) standIn += "x";
  return standIn;
};

/**
 * What {@link maskUrlWith} makes of a value: `text` is safe to show, the value itself only when `outcome` is `unchanged`.
 * `unparsable`: not a URL, so `text` is the mask alone. `masked`: the mask stands for a secret. `rewritten`: nothing is
 * masked, but the parser changed the URL (`/<key>/../v2` is `/v2`). `unchanged`: the parser keeps it, a bare origin's added `/` aside.
 *
 * @typedef {{ text: string, outcome: "unparsable" | "masked" | "rewritten" | "unchanged" }} MaskedUrl
 */

/**
 * `url` rebuilt from its parsed parts with credentials and tokens replaced by `mask`, an {@link isAppAsset} file name kept.
 * Built by hand so `mask` is never percent-encoded. A mask already in `url` stays, so masking a masked URL changes nothing.
 *
 * @param {string} mask what stands for each secret
 * @returns {(url: string) => MaskedUrl}
 */
export const maskUrlWith = (mask) => {
  const maskHost = maskHostWith(mask);
  const maskPath = maskPathWith(mask);
  const maskQuery = maskQueryWith(mask);
  const maskFragment = maskFragmentWith(mask);
  return (url) => {
    const standIn = standInFor(url);
    const parsable = url.replaceAll(mask, standIn);
    let parsed;
    try {
      parsed = new URL(parsable);
    } catch {
      // Not a URL: any part of it may be the key, so none of it is kept
      return { text: mask, outcome: "unparsable" };
    }
    // A function, so a `$` in `mask` is not read as a replacement pattern
    /** @type {(part: string) => string} */
    const written = (part) => part.replaceAll(standIn, () => mask);
    const hasAuth = parsed.username !== "" || parsed.password !== "";
    // A username and a password, either or both, show as one mask
    const auth = hasAuth ? `${mask}@` : "";
    const port = parsed.port ? `:${parsed.port}` : "";
    const hostname = written(parsed.hostname);
    const pathname = written(parsed.pathname);
    const search = written(parsed.search);
    const hash = written(parsed.hash);
    const host = maskHost(hostname);
    const path = maskPath(pathname);
    const query = search && `?${maskQuery(search.slice(1))}`;
    const fragment = hash && `#${maskFragment(hash.slice(1))}`;
    const text = `${parsed.protocol}//${auth}${host}${port}${path}${query}${fragment}`;
    // A part equals its masked form only when nothing in it was masked, or it held the mask already
    if (
      hasAuth ||
      host !== hostname ||
      path !== pathname ||
      query !== search ||
      fragment !== hash
    ) {
      return { text, outcome: "masked" };
    }
    const isAsWritten =
      parsed.href === parsable || parsed.href === `${parsable}/`;
    return { text, outcome: isAsWritten ? "unchanged" : "rewritten" };
  };
};
