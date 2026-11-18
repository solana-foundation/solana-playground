import { deflateRaw, Inflate } from "pako";

/** One file a docs page hands to Playground */
export interface DocsLink {
  /** File name, opened as `client/<name>` */
  name: string;
  /** The file's text */
  code: string;
  /** Shown above the code, as "From {host}: {title}" */
  title: string;
  /** The `https:` page on `solana.com` the link came from */
  from?: string;
  /** Devnet SOL the script needs before it can run */
  sol?: number;
}

/**
 * Why a link did not open: a required key absent, another format version,
 * code that does not decode, a file empty or over the cap, a bad file name, or
 * a `sol` that is not a positive number
 */
export type DocsLinkFailure =
  | "missing"
  | "version"
  | "decode"
  | "size"
  | "name"
  | "sol";

export type DecodedDocsLink =
  | { ok: true; link: DocsLink }
  | { ok: false; reason: DocsLinkFailure; from?: string };

/** The one format version this client reads */
const VERSION = "1";

/** Largest file a link may carry, inflated */
export const MAX_DOCS_LINK_BYTES = 100 * 1024;

/** A file name a link may give: no folders, a script's extension */
const NAME_REGEX = /^[A-Za-z0-9._-]+\.(ts|js)$/;

/** Where "Back to the docs" goes when nothing better is known */
export const DOCS_HOME = "https://solana.com/docs";

/**
 * Read a URL only when it is an `https:` page on `solana.com` or one of its
 * subdomains. A link is anyone's to craft, so anything else would let it point
 * "Back to the docs" at `javascript:` or at someone else's site.
 *
 * @param value the URL as the link or the referrer gives it
 * @returns the URL as the parser normalised it, or `undefined`
 */
const solanaPageOf = (value: string | null): string | undefined => {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Not a URL at all: the link has no usable source
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    return undefined;
  }
  const isSolana =
    url.hostname === "solana.com" || url.hostname.endsWith(".solana.com");
  return isSolana ? url.href : undefined;
};

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

/**
 * Read base64url, and plain base64 too: a hand-made link may use either. A
 * `+` left unescaped in the fragment reaches here as a space, since the
 * fragment is read as a query string.
 */
const fromBase64 = (text: string): Uint8Array => {
  const standard = text
    .replace(/ /g, "+")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binary = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

/**
 * Inflate a link's `code`.
 *
 * @param code base64url of raw DEFLATE
 * @returns the text, or the failure
 */
const inflateCode = (
  code: string
): { ok: true; text: string } | { ok: false; reason: "decode" | "size" } => {
  let input: Uint8Array;
  try {
    input = fromBase64(code);
  } catch {
    // Not base64: the link was damaged in transit
    return { ok: false, reason: "decode" };
  }

  // Inflate in chunks and stop past the cap: a few kilobytes of a crafted
  // stream inflate to gigabytes, so checking the size afterwards is too late
  const inflator = new Inflate({ raw: true, chunkSize: 16 * 1024 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  let isTooLarge = false;
  let isComplete = false;
  inflator.onData = (chunk) => {
    const bytes = chunk as Uint8Array;
    length += bytes.length;
    if (length > MAX_DOCS_LINK_BYTES) {
      isTooLarge = true;
      throw new Error("docs link larger than the cap");
    }
    chunks.push(bytes);
  };
  inflator.onEnd = (status) => {
    isComplete = status === 0;
  };
  try {
    inflator.push(input, true);
  } catch {
    // Thrown by `onData` past the cap, or by a stream pako cannot read
    if (!isTooLarge) return { ok: false, reason: "decode" };
  }
  if (isTooLarge) return { ok: false, reason: "size" };
  // A stream cut short ends without its final block, and without an error
  if (!isComplete) return { ok: false, reason: "decode" };
  if (!length) return { ok: false, reason: "size" };

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    // Bytes that are not UTF-8 are not a script
    return { ok: false, reason: "decode" };
  }
};

/**
 * Read a docs link from the URL's fragment.
 *
 * @param fragment the fragment, with or without its `#`
 * @returns the link, or why it is broken and the source page if readable
 */
export const decodeDocsLink = (fragment: string): DecodedDocsLink => {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const from = solanaPageOf(params.get("from"));
  const fail = (reason: DocsLinkFailure): DecodedDocsLink => ({
    ok: false,
    reason,
    from,
  });

  const version = params.get("v");
  const code = params.get("code");
  const name = params.get("name");
  if (!version || !code || !name) return fail("missing");
  if (version !== VERSION) return fail("version");
  if (!NAME_REGEX.test(name)) return fail("name");

  const sol = params.has("sol") ? Number(params.get("sol")) : undefined;
  if (sol !== undefined && !(Number.isFinite(sol) && sol > 0)) {
    return fail("sol");
  }

  const inflated = inflateCode(code);
  if (!inflated.ok) return fail(inflated.reason);

  return {
    ok: true,
    link: {
      name,
      code: inflated.text,
      title: params.get("title") || name.replace(/\.(ts|js)$/, ""),
      from,
      sol,
    },
  };
};

/**
 * Write a docs link's fragment: the inverse of `decodeDocsLink`, for tests.
 * The docs site builds its links from `docs/open-in-playground-link.md`.
 *
 * @param link the file and what travels with it
 * @returns the fragment, without its `#`
 */
export const encodeDocsLink = (
  link: Omit<DocsLink, "title"> & { title?: string }
): string => {
  const params = new URLSearchParams({ v: VERSION, name: link.name });
  if (link.title) params.set("title", link.title);
  if (link.from) params.set("from", link.from);
  if (link.sol !== undefined) params.set("sol", String(link.sol));
  params.set(
    "code",
    toBase64Url(deflateRaw(new TextEncoder().encode(link.code)))
  );
  return params.toString();
};

/**
 * Where "Back to the docs" goes: the link's own page, else the page the user
 * came from when it is Solana's, else the docs' home.
 *
 * @param from the link's `from`, already checked to be a Solana page
 * @param referrer `document.referrer`
 * @returns the URL to go to
 */
export const backToDocsHref = (from: string | undefined, referrer: string) => {
  if (from) return from;
  return solanaPageOf(referrer) ?? DOCS_HOME;
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("features/docs-link/lib/link", () => {
    const SCRIPT = [
      'import { createClient } from "@solana/kit";',
      'console.log("Step 1: Check a balance");',
      "const amount = 1_000_000n; // ünïcödé survives",
    ].join("\n");
    const QUICKSTART = {
      name: "quickstart.ts",
      code: SCRIPT,
      title: "Quickstart",
      from: "https://solana.com/docs/quickstart",
      sol: 0.02,
    };

    it("reads back every field it wrote", () => {
      expect(decodeDocsLink(encodeDocsLink(QUICKSTART))).toEqual({
        ok: true,
        link: QUICKSTART,
      });
    });

    it("takes the title from the name when the link has none", () => {
      const fragment = encodeDocsLink({
        name: "hello.ts",
        code: "console.log(1)",
      });
      const decoded = decodeDocsLink(`#${fragment}`);
      expect(decoded.ok && decoded.link.title).toBe("hello");
    });

    it("names why a link is broken", () => {
      const good = new URLSearchParams(encodeDocsLink(QUICKSTART));
      const withParam = (key: string, value: string | undefined) => {
        const params = new URLSearchParams(good);
        if (value === undefined) params.delete(key);
        else params.set(key, value);
        return decodeDocsLink(params.toString());
      };
      const code = good.get("code") ?? "";
      const reasonOf = (decoded: DecodedDocsLink) =>
        decoded.ok ? "ok" : decoded.reason;

      expect(reasonOf(withParam("code", undefined))).toBe("missing");
      expect(reasonOf(withParam("v", "2"))).toBe("version");
      expect(reasonOf(withParam("code", code.slice(0, -40)))).toBe("decode");
      expect(reasonOf(withParam("code", "%%%"))).toBe("decode");
      expect(reasonOf(withParam("name", "a.rs"))).toBe("name");
      expect(reasonOf(withParam("name", "../a.ts"))).toBe("name");
      expect(reasonOf(withParam("sol", "-1"))).toBe("sol");
      expect(reasonOf(withParam("sol", "lots"))).toBe("sol");
      expect(reasonOf(withParam("sol", "0"))).toBe("sol");
      expect(reasonOf(withParam("sol", "Infinity"))).toBe("sol");

      const tooBig = encodeDocsLink({
        name: "a.ts",
        code: "x".repeat(MAX_DOCS_LINK_BYTES + 1),
      });
      expect(reasonOf(decodeDocsLink(tooBig))).toBe("size");
    });

    it("keeps the source page of a broken link", () => {
      const decoded = decodeDocsLink(
        "v=1&name=a.ts&from=https%3A%2F%2Fsolana.com%2Fdocs%2Fquickstart"
      );
      expect(decoded).toEqual({
        ok: false,
        reason: "missing",
        from: "https://solana.com/docs/quickstart",
      });
    });

    it("reads plain base64 as well as base64url", () => {
      const params = new URLSearchParams(encodeDocsLink(QUICKSTART));
      const plain = (params.get("code") ?? "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      params.set("code", plain);
      expect(decodeDocsLink(params.toString()).ok).toBe(true);
    });

    it("reads a plus left unescaped in the fragment", () => {
      // This text deflates to a code whose standard base64 holds a "+"
      const script = 'const v11 = "1v7p~ü";';
      const code = (
        new URLSearchParams(encodeDocsLink({ name: "a.ts", code: script })).get(
          "code"
        ) ?? ""
      )
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      expect(code).toContain("+");

      const decoded = decodeDocsLink(`v=1&name=a.ts&code=${code}`);

      expect(decoded.ok && decoded.link.code).toBe(script);
    });

    it("stops inflating a stream that grows past the cap", () => {
      // Ten times the cap deflates to a few kilobytes; a check after inflating would still return "size"
      const bomb = encodeDocsLink({
        name: "a.ts",
        code: "a".repeat(MAX_DOCS_LINK_BYTES * 10),
      });
      const push = Inflate.prototype.push;
      let inflated = 0;
      const spy = vi
        .spyOn(Inflate.prototype, "push")
        .mockImplementation(function (this: Inflate, ...args) {
          const onData = this.onData.bind(this);
          this.onData = (chunk) => {
            inflated += (chunk as Uint8Array).length;
            onData(chunk);
          };
          return push.apply(this, args);
        });

      try {
        const decoded = decodeDocsLink(bomb);

        expect(decoded.ok || decoded.reason).toBe("size");
        expect(inflated).toBeGreaterThan(MAX_DOCS_LINK_BYTES);
        expect(inflated).toBeLessThanOrEqual(MAX_DOCS_LINK_BYTES + 16 * 1024);
      } finally {
        spy.mockRestore();
      }
    });

    it("never uses a source that is not an https Solana page", () => {
      const fromOfEncoded = (encoded: string) => {
        const decoded = decodeDocsLink(`v=1&from=${encoded}`);
        return decoded.ok || decoded.from;
      };
      const fromOf = (from: string) => fromOfEncoded(encodeURIComponent(from));
      expect(fromOfEncoded("javascript%3Aalert(1)")).toBeUndefined();
      // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- the insecure scheme is the input under test
      expect(fromOf("http://solana.com/docs")).toBeUndefined();
      expect(fromOf("https://evil.example/docs")).toBeUndefined();
      expect(fromOf("https://notsolana.com/docs")).toBeUndefined();
      expect(fromOf("https://solana.com.evil.example/docs")).toBeUndefined();
      expect(fromOf("https://solana.com@evil.example/docs")).toBeUndefined();
      expect(fromOf("https://user@solana.com/docs")).toBeUndefined();
      expect(fromOf("https://docs.solana.com/intro")).toBe(
        "https://docs.solana.com/intro"
      );
    });

    it("sends Back to the docs to the best page it knows", () => {
      const from = "https://solana.com/docs/quickstart";
      expect(backToDocsHref(from, "")).toBe(from);
      expect(
        backToDocsHref(undefined, "https://solana.com/docs/payments")
      ).toBe("https://solana.com/docs/payments");
      expect(backToDocsHref(undefined, "https://evil.example/solana.com")).toBe(
        DOCS_HOME
      );
      // A host that only ends in the name is someone else's
      expect(backToDocsHref(undefined, "https://notsolana.com/docs")).toBe(
        DOCS_HOME
      );
      // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- the insecure scheme is the input under test
      expect(backToDocsHref(undefined, "http://solana.com/docs")).toBe(
        DOCS_HOME
      );
      expect(backToDocsHref(undefined, "")).toBe(DOCS_HOME);
    });
  });
}
