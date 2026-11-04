// What a report from the browser must never carry: the user's program output,
// which their tests print to this window's console, and a secret key. The
// reporter passes these rules to Sentry as `beforeBreadcrumb` and `beforeSend`
// (`sentryOptions` in `reporter/sentry.ts`).

const REDACTED = "[redacted]";

/** Fewer bytes than a secret key or its 32-byte seed is not a key */
const MIN_KEY_BYTES = 32;

/** One number from 0 to 255, as text */
const BYTE = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";

/** `MIN_KEY_BYTES` or more bytes separated by commas */
const BYTE_LIST = `(?:${BYTE}\\s*,\\s*){${MIN_KEY_BYTES - 1},}${BYTE}`;

/**
 * A secret key written out: a hex or base58 run of 64+ characters (public keys
 * are 32 to 44, so they stay), or a list of 32+ bytes, bracketed or not. Hex
 * goes first: base58 has no `0`, so it would take a hex key only up to its
 * first zero. A transaction signature looks like a secret key in base58 and is
 * redacted too.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/[0-9a-fA-F]{64,}/g, REDACTED],
  [/[1-9A-HJ-NP-Za-km-z]{64,}/g, REDACTED],
  [new RegExp(`\\[\\s*${BYTE_LIST}\\s*\\]`, "g"), REDACTED],
  // The edge is captured, not looked behind: older Safari cannot parse a lookbehind
  [new RegExp(`(^|[^\\d.])${BYTE_LIST}(?![\\d.])`, "g"), `$1${REDACTED}`],
];

/** Past this depth a value is replaced rather than walked; Sentry's own normalising stops at 3 */
const MAX_DEPTH = 12;

const redactText = (text: string) =>
  SECRET_PATTERNS.reduce(
    (scrubbed, [pattern, replacement]) =>
      scrubbed.replace(pattern, replacement),
    text
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
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * A breadcrumb fit to send, or `null` to drop it. Every `console` breadcrumb
 * is dropped: the user's tests print to this window's console, and nothing in
 * a console call tells their output from ours. The logger's own trail arrives
 * as breadcrumbs the reporter adds (`trail` in `reporter/sentry.ts`).
 */
export const scrubBreadcrumb = <B extends Breadcrumb>(crumb: B): B | null =>
  // eslint-disable-next-line unicorn/no-null -- Sentry's `beforeBreadcrumb` drops a crumb only on `null`
  crumb.category === "console" ? null : (redact(crumb) as B);

interface ScrubbableEvent {
  event_id?: string;
  message?: string;
  timestamp?: number;
  level?: string;
  tags?: Record<string, unknown>;
  breadcrumbs?: Breadcrumb[];
}

/**
 * Sent in place of an event the rules could not walk (a throwing getter in a
 * context, say): Sentry drops an event whose `beforeSend` throws, without a
 * word, so the team at least learns that a report from `ns` was withheld.
 */
const withheld = <E extends ScrubbableEvent>(event: E): E => {
  const ns = event.tags?.ns;
  // Every field of Sentry's event is optional, so this reduced copy is still one
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    level: event.level,
    tags: typeof ns === "string" ? { ns: redactText(ns) } : {},
    message: "Report withheld: scrubbing it failed",
  } as unknown as E;
};

/** An error event with its breadcrumbs re-checked and every value in it redacted */
export const scrubEvent = <E extends ScrubbableEvent>(event: E): E => {
  try {
    const breadcrumbs = event.breadcrumbs
      ?.map(scrubBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
    const scrubbed = redact(event) as E;
    if (breadcrumbs !== undefined) scrubbed.breadcrumbs = breadcrumbs;
    return scrubbed;
  } catch {
    // Not logged: the logger reports through this reporter, and would loop
    return withheld(event);
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

        expect(redact(cyclic)).toMatchObject({ key: "[redacted]" });
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

      it("should withhold an event it cannot scrub rather than lose or leak it", () => {
        const hostile = {
          get boom(): string {
            throw new Error("getter");
          },
        };

        expect(
          scrubEvent({
            event_id: "e1",
            timestamp: 1,
            level: "error",
            message: `msg ${KEY}`,
            tags: { ns: "wallet:connect" },
            extra: { hostile },
          })
        ).toEqual({
          event_id: "e1",
          timestamp: 1,
          level: "error",
          tags: { ns: "wallet:connect" },
          message: "Report withheld: scrubbing it failed",
        });
      });
    });
  });
}
