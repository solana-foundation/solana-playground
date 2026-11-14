// What a report from the browser must never carry: the user's program output,
// which their tests print to this window's console, and a secret key. The
// reporter passes these rules to Sentry as `beforeBreadcrumb`, `beforeSend` and
// `beforeSendTransaction` (`sentryOptions` in `reporter/sentry.ts`).

import { maskUrlWith } from "../url-secret.mjs";

const REDACTED = "[redacted]";

/** Fewer bytes than a secret key or its 32-byte seed is not a key */
const MIN_KEY_BYTES = 32;

/** One number from 0 to 255, as text */
const BYTE = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";

/** `MIN_KEY_BYTES` or more bytes separated by commas */
const BYTE_LIST = `(?:${BYTE}\\s*,\\s*){${MIN_KEY_BYTES - 1},}${BYTE}`;

/** `MIN_KEY_BYTES` or more `"i": byte` pairs: `JSON.stringify` of a typed array */
const INDEXED_BYTES = `\\{\\s*"0"\\s*:\\s*${BYTE}(?:\\s*,\\s*"\\d+"\\s*:\\s*${BYTE}){${
  MIN_KEY_BYTES - 1
},}\\s*\\}`;

/**
 * A secret key written out: a hex run of 64+ characters (32+ bytes), a base64
 * run of 86+ (a 64-byte key), a base58 run of 64+, or 32+ bytes as a list,
 * bracketed or not, or as `JSON.stringify` of a typed array. Base58 text of 32
 * to 44 characters stays, so a public key in base58 is kept, and so is a
 * 32-byte seed written in base58 or base64 (43 or 44 characters), which cannot
 * be told from one. Any 32-byte value in hex or as bytes, a public key
 * included, is redacted. Hex goes first: base58 has no `0`, so it would take a
 * hex key only up to its first zero; base64 goes before base58, whose alphabet
 * lacks `0`, `O`, `I`, `l`, `+` and `/` and would cut a base64 key into
 * shorter runs. A transaction signature looks like a secret key in base58 and
 * is redacted too.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/[0-9a-fA-F]{64,}/g, REDACTED],
  [/[0-9A-Za-z+/]{86,}={0,2}/g, REDACTED],
  [/[1-9A-HJ-NP-Za-km-z]{64,}/g, REDACTED],
  [new RegExp(INDEXED_BYTES, "g"), REDACTED],
  [new RegExp(`\\[\\s*${BYTE_LIST}\\s*\\]`, "g"), REDACTED],
  // The edge is captured, not looked behind: older Safari cannot parse a lookbehind
  [new RegExp(`(^|[^\\d.])${BYTE_LIST}(?![\\d.])`, "g"), `$1${REDACTED}`],
];

/** Past this depth a value is replaced rather than walked; Sentry's own normalising stops at 3 */
const MAX_DEPTH = 12;

/** An `http(s)://` URL in running text: it ends at whitespace, a quote, a bracket or a character a URL escapes */
const URL_IN_TEXT = /https?:\/\/[^\s"'`<>()[\]{}\\^|]+/gi;

const maskUrl = maskUrlWith(REDACTED);

/** `text` with the secrets of each URL in it masked; a URL with none stays as written, unnormalised */
const maskUrlsIn = (text: string) =>
  text.replace(URL_IN_TEXT, (url) => {
    const { text: shown, masked } = maskUrl(url);
    return masked ? shown : url;
  });

const redactText = (text: string) =>
  SECRET_PATTERNS.reduce(
    (scrubbed, [pattern, replacement]) =>
      scrubbed.replace(pattern, replacement),
    maskUrlsIn(text)
  );

const isByte = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 255;

/** An object whose keys are exactly `0` to `n - 1`: what Sentry makes of a typed array */
const isIndexKeyed = (value: object) => {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key, i) => key === String(i));
};

/** A key's bytes in any of the shapes they reach a report in */
const isKeyBytes = (value: unknown) => {
  if (ArrayBuffer.isView(value)) return value.byteLength >= MIN_KEY_BYTES;
  if (typeof value !== "object" || value === null) return false;
  let items: unknown[];
  if (Array.isArray(value)) items = value;
  else if (isIndexKeyed(value)) items = Object.values(value);
  else return false;
  return items.length >= MIN_KEY_BYTES && items.every(isByte);
};

/**
 * What an object says it holds, as `JSON.stringify` and Sentry's normalising
 * would read it: `toJSON()` when it has one (a `PublicKey` gives its base58
 * text), and an `Error`'s `name`, `message` and `stack`, which are not its own
 * enumerable fields. Breadcrumb data reaches the scrub before Sentry
 * normalises it, so walking only `Object.entries` would send `{}` for either.
 */
const dataOf = (value: object): unknown => {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  const { toJSON } = value as { toJSON?: unknown };
  return typeof toJSON === "function" ? toJSON.call(value) : value;
};

/** `ancestors` holds the objects above `value`, so only a cycle is cut, not a shared object */
const walkWith =
  (ancestors: object[]) =>
  (value: unknown): unknown => {
    if (typeof value === "string") return redactText(value);
    if (isKeyBytes(value)) return REDACTED;
    if (typeof value !== "object" || value === null) return value;
    if (ancestors.length >= MAX_DEPTH || ancestors.includes(value)) {
      return REDACTED;
    }
    // Not `concat`: it would spread an array's items in as ancestors
    const walkBelow = walkWith([...ancestors, value]);
    const data = dataOf(value);
    // One level down, so a `toJSON` that returns a fresh object each time still ends
    if (data !== value) return walkBelow(data);
    if (Array.isArray(value)) return value.map((item) => walkBelow(item));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactText(key),
        walkBelow(item),
      ])
    );
  };

/** `value` with every secret-shaped string and byte list replaced by `[redacted]` */
const redact = walkWith([]);

interface Breadcrumb {
  category?: string;
  level?: string;
  timestamp?: number;
  message?: string;
  data?: Record<string, unknown>;
}

interface WithBreadcrumbs {
  breadcrumbs?: Breadcrumb[];
}

/** `read()`, or `undefined` if it throws: what a withheld copy keeps of a hostile value */
const attempt = <T>(read: () => T): T | undefined => {
  try {
    return read();
  } catch {
    // Not logged: the logger reports through this reporter, and would loop
    return undefined;
  }
};

const textOf = (value: unknown) =>
  typeof value === "string" ? redactText(value) : undefined;

/**
 * A breadcrumb fit to send, or `null` to drop it. Every `console` breadcrumb
 * is dropped: the user's tests print to this window's console, and nothing in
 * a console call tells their output from ours. The logger's own trail arrives
 * as breadcrumbs the reporter adds (`trail` in `reporter/sentry.ts`).
 */
export const scrubBreadcrumb = <B extends Breadcrumb>(crumb: B): B | null => {
  try {
    // eslint-disable-next-line unicorn/no-null -- Sentry's `beforeBreadcrumb` drops a crumb only on `null`
    return crumb.category === "console" ? null : (redact(crumb) as B);
  } catch {
    // A throwing getter or `toJSON` in its data: keep where and when, not what
    return {
      category: attempt(() => textOf(crumb.category)),
      level: attempt(() => textOf(crumb.level)),
      timestamp: attempt(() => crumb.timestamp),
      message: "Breadcrumb withheld: scrubbing it failed",
    } as B;
  }
};

interface ScrubbableEvent {
  event_id?: string;
  message?: string;
  timestamp?: number;
  level?: string;
  release?: string;
  environment?: string;
  dist?: string;
  platform?: string;
  sdk?: unknown;
  tags?: Record<string, unknown>;
  exception?: { values?: { type?: unknown }[] };
  breadcrumbs?: Breadcrumb[];
}

/**
 * Sent in place of an event the rules could not walk (a throwing getter in an
 * exception or a tag, say): Sentry drops an event whose `beforeSend` throws,
 * without a word, so the team at least learns that a report from `ns` was
 * withheld. It keeps what tells deploys and failures apart (release,
 * environment, the exception's type, the name of what the scrub threw), never
 * a message, which could hold the secret, and groups by `ns` rather than by
 * its one shared message.
 */
const withheld = <E extends ScrubbableEvent>(event: E, failure: unknown): E => {
  const ns = attempt(() => textOf(event.tags?.ns));
  const types = attempt(() =>
    event.exception?.values
      ?.map((value) => textOf(value.type))
      .filter(Boolean)
      .join(", ")
  );
  const thrown = attempt(() =>
    failure instanceof Error ? textOf(failure.name) : typeof failure
  );
  const tags: Record<string, string> = {};
  if (ns) tags.ns = ns;
  if (types) tags.exception_type = types;
  if (thrown) tags.scrub_error = thrown;
  // Every field of Sentry's event is optional, so this reduced copy is still one
  return {
    event_id: attempt(() => textOf(event.event_id)),
    timestamp: attempt(() => event.timestamp),
    level: attempt(() => textOf(event.level)),
    release: attempt(() => textOf(event.release)),
    environment: attempt(() => textOf(event.environment)),
    dist: attempt(() => textOf(event.dist)),
    platform: attempt(() => textOf(event.platform)),
    sdk: attempt(() => redact(event.sdk)),
    tags,
    fingerprint: ["scrub-withheld", ns ?? "unknown"],
    message: "Report withheld: scrubbing it failed",
  } as unknown as E;
};

/**
 * `event` with its breadcrumbs re-checked and every value in it redacted;
 * throws when the walk does. Sentry merges the scope's breadcrumbs into
 * transactions too, so both kinds of event go through it.
 */
const scrubbedOf = <E extends object>(event: E): E => {
  const breadcrumbs = (event as WithBreadcrumbs).breadcrumbs
    ?.map(scrubBreadcrumb)
    .filter((crumb): crumb is Breadcrumb => crumb !== null);
  const scrubbed = redact(event) as E;
  if (breadcrumbs !== undefined) {
    (scrubbed as WithBreadcrumbs).breadcrumbs = breadcrumbs;
  }
  return scrubbed;
};

/** An error event with its breadcrumbs re-checked and every value in it redacted */
export const scrubEvent = <E extends ScrubbableEvent>(event: E): E => {
  try {
    return scrubbedOf(event);
  } catch (failure) {
    // Not logged: the logger reports through this reporter, and would loop
    return withheld(event, failure);
  }
};

/**
 * A transaction scrubbed as {@link scrubEvent} scrubs an error, its spans
 * included, or `null` to drop it when the walk throws: a withheld stand-in
 * would carry no measurement and still cost quota.
 */
export const scrubTransaction = <E extends object>(event: E): E | null => {
  try {
    return scrubbedOf(event);
  } catch {
    // Not logged: importing the logger would close a cycle (logger, providers/sentry, reporter, scrub); Sentry's client reports count the drop as `before_send` for category `transaction`
    // eslint-disable-next-line unicorn/no-null -- Sentry's `beforeSendTransaction` drops a transaction only on `null`
    return null;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/reporter/scrub", () => {
    // A 64-byte secret key's length in base58, and a 44-character public key
    const KEY = "3Xz9".repeat(22);
    const PUBKEY = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    const bytes = (length: number) =>
      Array.from({ length }, (_, i) => (i * 7) % 256);
    // eslint-disable-next-line no-restricted-syntax -- shared cannot import Endpoint from entities, and the URL is only text here
    const DEVNET = "https://api.devnet.solana.com/";

    describe("redact", () => {
      it("should replace a base58 secret key inside a sentence", () => {
        expect(redact(`bad key ${KEY} in wallet`)).toBe(
          "bad key [redacted] in wallet"
        );
      });

      it("should keep a public key", () => {
        expect(redact(`owner ${PUBKEY}`)).toBe(`owner ${PUBKEY}`);
      });

      it("should replace a 64-character hex run", () => {
        expect(redact(`seed ${"ab12".repeat(16)}`)).toBe("seed [redacted]");
      });

      it("should replace a JSON byte array in text", () => {
        expect(
          redact(`Unexpected token in ${JSON.stringify(bytes(64))} at 3`)
        ).toBe("Unexpected token in [redacted] at 3");
      });

      it("should keep a short list of numbers in text", () => {
        expect(redact("expected [1, 2, 3]")).toBe("expected [1, 2, 3]");
      });

      it.each([
        ["a Uint8Array", () => new Uint8Array(64)],
        ["a number array", () => bytes(64)],
      ])("should replace %s of 64 bytes", (_, make) => {
        expect(redact(make())).toBe("[redacted]");
      });

      it("should keep a short number array", () => {
        expect(redact([1, 2, 3])).toEqual([1, 2, 3]);
      });

      it("should redact at depth and keep the shape", () => {
        expect(
          redact({ wallet: { secretKey: new Uint8Array(64), owner: PUBKEY } })
        ).toEqual({ wallet: { secretKey: "[redacted]", owner: PUBKEY } });
      });

      it("should replace a long hex key that holds zeros whole", () => {
        const hex = "a0b1".repeat(32);

        expect(redact(`kp ${hex}`)).toBe("kp [redacted]");
      });

      it("should replace a byte list written without brackets", () => {
        expect(redact(`key ${bytes(64).join(",")} end`)).toBe(
          "key [redacted] end"
        );
      });

      it("should keep a list whose numbers are not bytes", () => {
        const list = `[${Array.from({ length: 40 }, () => 999).join(",")}]`;

        expect(redact(list)).toBe(list);
      });

      it.each([
        ["a Uint16Array", () => new Uint16Array(32)],
        ["a Buffer-like view", () => new DataView(new ArrayBuffer(64))],
      ])("should replace %s holding a key's bytes", (_, make) => {
        expect(redact(make())).toBe("[redacted]");
      });

      // Sentry's `normalize` turns a typed array into an index-keyed object before `beforeSend`
      it("should replace an index-keyed object of 64 bytes", () => {
        expect(redact({ sk: Object.assign({}, bytes(64)) })).toEqual({
          sk: "[redacted]",
        });
      });

      it("should keep an index-keyed object that is not bytes", () => {
        expect(redact({ "0": "a", "1": "b" })).toEqual({ "0": "a", "1": "b" });
      });

      it("should keep a shared object that is not a cycle", () => {
        const shared = { owner: PUBKEY };

        expect(redact({ a: shared, b: shared })).toEqual({
          a: { owner: PUBKEY },
          b: { owner: PUBKEY },
        });
      });

      it("should redact a key that is itself a secret", () => {
        expect(redact({ [KEY]: 1 })).toEqual({ "[redacted]": 1 });
      });

      it("should survive a cycle", () => {
        const cyclic: Record<string, unknown> = { key: KEY };
        cyclic.self = cyclic;

        expect(redact(cyclic)).toEqual({
          key: "[redacted]",
          self: "[redacted]",
        });
      });

      // Each row sits at a threshold, so moving one by a step fails a row
      it.each(
        [
          ["a text list of 32 bytes", bytes(32).join(", "), "[redacted]"],
          [
            "a text list of 31 bytes",
            bytes(31).join(", "),
            bytes(31).join(", "),
          ],
          ["a bracketed list of 32 bytes", `[${bytes(32)}]`, "[redacted]"],
          [
            "a spaced list of 32 bytes",
            `[ ${bytes(32).join(" , ")} ]`,
            "[redacted]",
          ],
          ["a bare list of 32 bytes", bytes(32).join(","), "[redacted]"],
          ["64 hex characters with zeros", "0a".repeat(32), "[redacted]"],
          ["63 hex characters", "0a".repeat(31) + "0", "0a".repeat(31) + "0"],
          ["64 base58 characters", "3Xz9".repeat(16), "[redacted]"],
          [
            "63 base58 characters",
            "3Xz9".repeat(15) + "3Xz",
            "3Xz9".repeat(15) + "3Xz",
          ],
          ["an 88-character base64 key", "aO0+/lI1".repeat(11), "[redacted]"],
          [
            "a padded base64 key",
            `${"aO0+/lI1".repeat(10)}aO0+/l==`,
            "[redacted]",
          ],
          [
            "a 44-character base64 seed",
            "aO0+/lI1".repeat(5) + "aO0=",
            "aO0+/lI1".repeat(5) + "aO0=",
          ],
          [
            "a stringified Uint8Array of 32 bytes",
            JSON.stringify(new Uint8Array(32)),
            "[redacted]",
          ],
          [
            "a stringified Uint8Array of 31 bytes",
            JSON.stringify(new Uint8Array(31)),
            JSON.stringify(new Uint8Array(31)),
          ],
        ].map(([name, text, scrubbed]) => ({ name, text, scrubbed }))
      )("should handle $name in text", ({ text, scrubbed }) => {
        expect(redact(`k ${text} end`)).toBe(`k ${scrubbed} end`);
      });

      it.each(
        [
          ["a number array", bytes(32), bytes(31)],
          ["a Uint8Array", new Uint8Array(32), new Uint8Array(31)],
          [
            "an index-keyed object",
            Object.assign({}, bytes(32)),
            Object.assign({}, bytes(31)),
          ],
        ].map(([name, at, below]) => ({ name, at, below }))
      )(
        "should redact $name of 32 bytes and keep one of 31",
        ({ at, below }) => {
          expect(redact(at)).toBe("[redacted]");
          expect(redact(below)).not.toBe("[redacted]");
        }
      );

      it("should walk what toJSON gives, as Sentry would", () => {
        const publicKey = { _bn: { words: [1, 2] }, toJSON: () => PUBKEY };

        expect(redact({ owner: publicKey })).toEqual({ owner: PUBKEY });
      });

      it("should keep an Error's name, message and stack, redacted", () => {
        const error = new Error(`bad ${KEY}`);
        error.stack = "Error: bad\n    at push";

        expect(redact({ error })).toEqual({
          error: {
            name: "Error",
            message: "bad [redacted]",
            stack: "Error: bad\n    at push",
          },
        });
      });

      it("should end at depth when toJSON returns a fresh object each time", () => {
        const endless = (): object => ({ toJSON: endless });

        expect(redact(endless())).toBe("[redacted]");
      });

      it.each([
        {
          url: "https://solana-mainnet.g.alchemy.com/v2/abc123def456ghi789",
          shown: "https://solana-mainnet.g.alchemy.com/v2/[redacted]",
        },
        {
          url: "https://x.solana-mainnet.quiknode.pro/0123456789abcdef0123456789abcdef01234567/",
          shown: "https://x.solana-mainnet.quiknode.pro/[redacted]/",
        },
        {
          url: "https://devnet.helius-rpc.com/?api-key=abc",
          shown: "https://devnet.helius-rpc.com/?api-key=[redacted]",
        },
        { url: DEVNET, shown: DEVNET },
      ])("should show $url as $shown", ({ url, shown }) => {
        expect(redact(url)).toBe(shown);
      });

      it("should mask a URL inside a span description", () => {
        expect(
          redact(
            "POST https://solana-mainnet.g.alchemy.com/v2/abc123def456ghi789 (200)"
          )
        ).toBe("POST https://solana-mainnet.g.alchemy.com/v2/[redacted] (200)");
      });

      it("should leave numbers, booleans and null as they are", () => {
        // eslint-disable-next-line unicorn/no-null -- a Sentry event carries `null` values, and they pass through
        const nothing = null;
        expect([redact(3), redact(true), redact(nothing)]).toEqual([
          3,
          true,
          nothing,
        ]);
      });
    });

    describe("scrubBreadcrumb", () => {
      it.each([
        ["the user's test output", `  ✔ prints ${KEY}`],
        ["output that mimics the logger's tag", "[test:run] balance 5 SOL"],
      ])("should drop every console breadcrumb, such as %s", (_, message) => {
        expect(
          scrubBreadcrumb({
            category: "console",
            message,
            data: { arguments: [message], logger: "console" },
          })
        ).toBeNull();
      });

      it("should keep the logger's breadcrumb and redact it", () => {
        expect(
          scrubBreadcrumb({
            category: "persistence:sync",
            message: `push rejected ${KEY}`,
            data: { projectId: "p1", kp: bytes(64) },
          })
        ).toEqual({
          category: "persistence:sync",
          message: "push rejected [redacted]",
          data: { projectId: "p1", kp: "[redacted]" },
        });
      });

      it("should keep a logged context's Error and public key", () => {
        const error = new Error("push slow");
        error.stack = "Error: push slow";

        expect(
          scrubBreadcrumb({
            category: "persistence:sync",
            data: { error, owner: { toJSON: () => PUBKEY } },
          })
        ).toEqual({
          category: "persistence:sync",
          data: {
            error: {
              name: "Error",
              message: "push slow",
              stack: "Error: push slow",
            },
            owner: PUBKEY,
          },
        });
      });

      it("should withhold a breadcrumb it cannot walk, keeping where and when", () => {
        const hostile = {
          toJSON: () => {
            throw new Error(`getter ${KEY}`);
          },
        };

        expect(
          scrubBreadcrumb({
            category: "persistence:sync",
            level: "warning",
            timestamp: 2,
            message: `push ${KEY}`,
            data: { hostile },
          })
        ).toEqual({
          category: "persistence:sync",
          level: "warning",
          timestamp: 2,
          message: "Breadcrumb withheld: scrubbing it failed",
        });
      });

      it("should redact a key in another breadcrumb's data", () => {
        expect(
          scrubBreadcrumb({
            category: "fetch",
            data: { url: `/api/x?k=${KEY}`, method: "GET" },
          })
        ).toEqual({
          category: "fetch",
          data: { url: "/api/x?k=[redacted]", method: "GET" },
        });
      });
    });

    describe("scrubEvent", () => {
      it("should redact every part of an event that can carry text", () => {
        expect(
          scrubEvent({
            message: `msg ${KEY}`,
            exception: { values: [{ type: "Error", value: `bad ${KEY}` }] },
            breadcrumbs: [
              { category: "console", message: "  1) failing test" },
              { category: "ui.click", message: "button.deploy" },
            ],
            extra: { owner: PUBKEY, secret: bytes(64) },
            contexts: { wallet: { kp: KEY } },
            tags: { ns: "wallet:connect", key: KEY },
            request: {
              url: `https://x.test/?k=${KEY}`,
              headers: { Referer: `https://x.test/?k=${KEY}` },
            },
            user: { id: KEY },
            logentry: { message: `log ${KEY}` },
          })
        ).toEqual({
          message: "msg [redacted]",
          exception: { values: [{ type: "Error", value: "bad [redacted]" }] },
          breadcrumbs: [{ category: "ui.click", message: "button.deploy" }],
          extra: { owner: PUBKEY, secret: "[redacted]" },
          contexts: { wallet: { kp: "[redacted]" } },
          tags: { ns: "wallet:connect", key: "[redacted]" },
          request: {
            url: "https://x.test/?k=[redacted]",
            headers: { Referer: "https://x.test/?k=[redacted]" },
          },
          user: { id: "[redacted]" },
          logentry: { message: "log [redacted]" },
        });
      });

      it("should leave an event with nothing to scrub as it is", () => {
        expect(scrubEvent({ message: "push rejected" })).toEqual({
          message: "push rejected",
        });
      });

      // `exception`, `tags` and `request` reach `beforeSend` as they were made; Sentry has
      // normalised `extra`, `contexts`, `user` and breadcrumb data before it
      const hostile = {
        get boom(): string {
          throw new TypeError(`getter ${KEY}`);
        },
      };

      const TAGS = { ns: "wallet:connect" };
      const EXCEPTION = { values: [{ type: "TypeError" }] };

      it.each([
        {
          name: "an exception",
          exception: { values: [{ type: "Error", hostile }] },
          tags: TAGS,
          request: undefined,
          type: "Error",
        },
        {
          name: "a tag",
          exception: EXCEPTION,
          tags: { ns: "wallet:connect", hostile },
          request: undefined,
          type: "TypeError",
        },
        {
          name: "the request",
          exception: EXCEPTION,
          tags: TAGS,
          request: { headers: hostile },
          type: "TypeError",
        },
      ])(
        "should withhold an event with a throwing getter in $name rather than lose or leak it",
        ({ exception, tags, request, type }) => {
          const scrubbed = scrubEvent({
            event_id: "e1",
            timestamp: 1,
            level: "error",
            release: "abc123",
            environment: "preview",
            dist: "d1",
            platform: "javascript",
            sdk: { name: "sentry.javascript.react", version: "9" },
            message: `msg ${KEY}`,
            tags,
            exception,
            request,
          });

          expect(scrubbed).toEqual({
            event_id: "e1",
            timestamp: 1,
            level: "error",
            release: "abc123",
            environment: "preview",
            dist: "d1",
            platform: "javascript",
            sdk: { name: "sentry.javascript.react", version: "9" },
            tags: {
              ns: "wallet:connect",
              exception_type: type,
              scrub_error: "TypeError",
            },
            fingerprint: ["scrub-withheld", "wallet:connect"],
            message: "Report withheld: scrubbing it failed",
          });
          expect(JSON.stringify(scrubbed)).not.toContain(KEY);
        }
      );
    });

    describe("scrubTransaction", () => {
      it("should drop a console breadcrumb merged into the transaction", () => {
        expect(
          scrubTransaction({
            type: "transaction",
            breadcrumbs: [
              { category: "console", message: "  1) failing test" },
              { category: "ui.click", message: "button.deploy" },
            ],
          })
        ).toEqual({
          type: "transaction",
          breadcrumbs: [{ category: "ui.click", message: "button.deploy" }],
        });
      });

      it("should drop a transaction it cannot walk", () => {
        const hostile = {
          get boom(): string {
            throw new TypeError(`getter ${KEY}`);
          },
        };

        expect(
          scrubTransaction({ type: "transaction", spans: [{ data: hostile }] })
        ).toBeNull();
      });
    });
  });
}
