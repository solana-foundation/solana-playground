/**
 * Point the head of upstream's `public/index.html` at the brand's icons and
 * theme colour, so a browser, a crawler or a home screen reads them from the
 * markup without running the bundle.
 *
 * The same block carries the share card (Open Graph and Twitter tags), so a
 * link preview reads the brand's image, title and description from markup.
 *
 * `craco.config.js` applies it when webpack writes the page, and the file
 * stays upstream's: owning a copy of it would silently drop any later
 * upstream change to the head. Only the icon links, `theme-color` and the
 * card tags are replaced; the files they name are the fork's, in `public/`.
 */

/** Design's copy, and the line `og.png` itself carries */
export const DESCRIPTION =
  "Write, build and deploy Solana programs in your browser.";
export const IMAGE_ALT = `Solana Playground logo on a dark background with the line: ${DESCRIPTION}`;

/** A value placed inside a double-quoted attribute, so copy cannot break the tag */
const escapeAttr = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * The site's origin, from `SITE_URL`, else Vercel's production domain, else
 * the local dev server. Card URLs must be absolute: crawlers do not resolve
 * relative ones, so `%PUBLIC_URL%` cannot serve here.
 *
 * @param {Record<string, string | undefined>} env the build's environment
 * @returns {string} an `http` or `https` origin, without a trailing slash
 * @throws when the chosen value is not an absolute `http(s)` URL without a path
 */
export const resolveSiteUrl = (env) => {
  const [name, value] = [
    ["SITE_URL", env.SITE_URL],
    [
      "VERCEL_PROJECT_PRODUCTION_URL",
      env.VERCEL_PROJECT_PRODUCTION_URL &&
        `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`,
    ],
  ].find(([, candidate]) => candidate) ?? ["default", "http://localhost:3000"];
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${name} gives "${value}", not an absolute URL`, {
      cause: error,
    });
  }
  const isOrigin =
    ["http:", "https:"].includes(url.protocol) &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash;
  if (!isOrigin) {
    throw new Error(
      `${name} gives "${value}"; the share card needs an http(s) origin with no path`
    );
  }
  return url.origin;
};

/**
 * The share card, as design delivered it; the title is the manifest name, so
 * a preview and an installed app read the same
 *
 * @param {string} siteUrl an origin from {@link resolveSiteUrl}
 */
const cardFor = (siteUrl) =>
  [
    ["property", "og:type", "website"],
    ["property", "og:site_name", "Solana Playground"],
    ["property", "og:title", "Solana Playground"],
    ["property", "og:description", DESCRIPTION],
    ["property", "og:url", `${siteUrl}/`],
    ["property", "og:image", `${siteUrl}/og.png`],
    ["property", "og:image:type", "image/png"],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", IMAGE_ALT],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", "Solana Playground"],
    ["name", "twitter:description", DESCRIPTION],
    ["name", "twitter:image", `${siteUrl}/og.png`],
    ["name", "twitter:image:alt", IMAGE_ALT],
  ].map(
    ([attr, key, content]) =>
      `<meta ${attr}="${key}" content="${escapeAttr(content)}" />`
  );

/**
 * The tags that replace upstream's, in order: icons, theme colour, card;
 * `#101011` is the DS `--background`
 *
 * @param {string} siteUrl an origin from {@link resolveSiteUrl}
 */
export const brandTagsFor = (siteUrl) => [
  '<link rel="icon" href="%PUBLIC_URL%/favicon.ico" sizes="32x32" />',
  '<link rel="icon" href="%PUBLIC_URL%/favicon.svg" type="image/svg+xml" />',
  '<link rel="icon" href="%PUBLIC_URL%/favicon-96x96.png" type="image/png" sizes="96x96" />',
  '<link rel="apple-touch-icon" href="%PUBLIC_URL%/apple-touch-icon.png" />',
  '<meta name="theme-color" content="#101011" />',
  ...cardFor(siteUrl),
];

/** A tag's text, lower-cased, with one space between attributes and `=` tight */
const normalize = (tag) =>
  tag
    .toLowerCase()
    .replaceAll("'", '"')
    .replace(/\s+/g, " ")
    .replaceAll(" = ", "=")
    .replaceAll("= ", "=")
    .replaceAll(" =", "=");

/** An attribute's value in a normalized tag, quoted or not */
const valueOf = (tag, name) => {
  const key = ` ${name}=`;
  const at = tag.indexOf(key);
  if (at === -1) return undefined;
  const rest = tag.slice(at + key.length);
  if (rest.startsWith('"')) return rest.slice(1, rest.indexOf('"', 1));
  return rest.split(" ")[0];
};

/**
 * An icon link, the theme colour or a card tag. A card key counts under either
 * attribute, `name` or `property`: pages use both, and crawlers read both.
 */
const isBrandTag = (tag) => {
  const text = normalize(tag);
  if (text.startsWith("<link ")) {
    return valueOf(text, "rel")?.includes("icon") ?? false;
  }
  if (!text.startsWith("<meta ")) return false;
  const key = valueOf(text, "name") ?? valueOf(text, "property") ?? "";
  return (
    key === "theme-color" || key.startsWith("og:") || key.startsWith("twitter:")
  );
};

/** Every tag of the page with where it sits, a tag split over lines included */
const tagsOf = (html) => {
  const tags = [];
  let start = html.indexOf("<");
  while (start !== -1) {
    const end = html.indexOf(">", start) + 1;
    if (end === 0) break;
    tags.push({ text: html.slice(start, end), start, end });
    start = html.indexOf("<", end);
  }
  return tags;
};

/** The page without each brand tag that has its lines to itself */
const stripBrandTags = (html) => {
  let kept = "";
  let from = 0;
  for (const { text, start, end } of tagsOf(html)) {
    if (!isBrandTag(text)) continue;
    const lineStart = html.lastIndexOf("\n", start) + 1;
    const lineEnd = html.indexOf("\n", end) + 1 || html.length;
    const hasCompany =
      html.slice(lineStart, start).trim() || html.slice(end, lineEnd).trim();
    if (hasCompany) continue;
    kept += html.slice(from, lineStart);
    from = lineEnd;
  }
  return kept + html.slice(from);
};

/**
 * Idempotent: a second run strips the brand block and puts it back.
 *
 * @param {string} siteUrl an origin from {@link resolveSiteUrl}
 * @returns {(html: string) => string} upstream's page to the page with the
 *   brand's icon and card block after its charset
 * @throws when the page has no `<meta charset>` line or no `</head>`, or when
 *   an icon link, theme colour or card tag the strip left (one sharing a line)
 *   survives beside the brand's, so a restructured upstream page fails the
 *   build instead of shipping a mixed head
 */
export const brandHeadFor = (siteUrl) => (html) => {
  const brandTags = brandTagsFor(siteUrl);
  if (!html.includes("</head>")) {
    throw new Error("index.html has no </head>; cannot place the brand head");
  }
  const stripped = stripBrandTags(html);
  const charset = stripped
    .split("\n")
    .find((line) => line.trim().startsWith("<meta charset="));
  if (charset === undefined) {
    throw new Error(
      "index.html has no <meta charset> line; cannot place the brand head"
    );
  }
  const indent = charset.slice(0, charset.length - charset.trimStart().length);
  const block = brandTags.map((tag) => `${indent}${tag}\n`).join("");
  const branded = stripped.replace(
    `${charset}\n`,
    () => `${charset}\n${block}`
  );
  if (
    tagsOf(branded).filter(({ text }) => isBrandTag(text)).length !==
    brandTags.length
  ) {
    throw new Error(
      "index.html keeps an icon link, theme-color or card tag the rewrite did not remove; " +
        "update isBrandTag in scripts/brand-head.mjs for upstream's new markup"
    );
  }
  return branded;
};
