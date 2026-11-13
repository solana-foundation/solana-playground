import { createLogger } from "@/shared/lib/logger";
import {
  isSecretQueryTerm,
  isTokenLike,
  queryTermsOf,
} from "@/shared/lib/url-secret.mjs";

import { CLUSTERS, Endpoint, offeredOf } from "./clusters";

const log = createLogger("custom-rpc:store");

/** A custom RPC the user saved, under a name of their own */
export interface CustomRpc {
  name: string;
  url: string;
}

export type UrlCheck =
  | { ok: true; url: string }
  | { ok: false; reason: "format" };

/** Plain HTTP only where the browser lets an HTTPS page call it */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** The longest name a saved RPC keeps; the form's field stops there too */
export const RPC_NAME_MAX = 32;

/** `localStorage` key of the saved list */
const KEY = "customRpcs";

/** `localStorage` key of the network chip picked last, see `PgCustomRpcs.chosen` */
const CHOSEN_KEY = "customRpcChosen";

/**
 * Whether a typed value may be saved as an RPC (spec `client-v2-custom-rpcs`): `https://`, or
 * `http://` on `localhost` or `127.0.0.1`, and nothing else. A saved URL is
 * normalised, so two spellings of one address compare equal.
 */
export const checkRpcUrl = (value: string): UrlCheck => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    // Never the value, nor the error quoting it: an RPC URL often holds an API key
    log.info("a typed RPC URL does not parse");
    return { ok: false, reason: "format" };
  }
  const secure = url.protocol === "https:";
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (!url.hostname || (!secure && !local)) {
    return { ok: false, reason: "format" };
  }
  return { ok: true, url: url.href };
};

/** A URL's host, port included: an unnamed RPC's default name */
export const hostOf = (url: string): string => new URL(url).host;

/** What stands for a secret: four dots, whatever the secret's length */
const MASK = "••••";

/** A saved RPC's URL as the page draws it, and whether anything was masked */
export interface MaskedUrl {
  /** For display only: never parse or fetch it, its secrets are `••••` */
  text: string;
  /** Whether anything was masked, which the "API key" badge says */
  masked: boolean;
}

/** What a stored value that is not a URL shows: nothing of it */
const UNREADABLE: MaskedUrl = { text: MASK, masked: true };

/**
 * A saved RPC's whole URL with every secret in it as `••••` (spec
 * `client-v2-custom-rpcs`): a non-empty query value under a key-like name;
 * a host label, path segment, query value or bare query term, or fragment
 * that looks like a token; and a username and password. Built from the
 * parsed URL's parts split by hand, not `URLSearchParams`, so names keep
 * their spelling and `••••` is never percent-encoded.
 */
export const maskRpcUrl = (url: string): MaskedUrl => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Never the value, nor the error quoting it: it may be a key
    log.info("a saved RPC URL does not parse; drawn fully masked");
    return UNREADABLE;
  }
  let masked = false;
  const mask = () => {
    masked = true;
    return MASK;
  };
  /** The part itself, or `••••` when it reads as a token */
  const maskToken = (part: string) => (isTokenLike(part) ? mask() : part);

  // A username and a password, either or both, show as one `••••`
  const auth = parsed.username || parsed.password ? `${mask()}@` : "";
  const host =
    parsed.hostname.split(".").map(maskToken).join(".") +
    (parsed.port ? `:${parsed.port}` : "");
  const path = parsed.pathname.split("/").map(maskToken).join("/");
  const query = parsed.search
    ? "?" +
      queryTermsOf(parsed.search)
        .map(([name, value]) => {
          if (value === undefined) return maskToken(name);
          return `${name}=${isSecretQueryTerm(name, value) ? mask() : value}`;
        })
        .join("&")
    : "";
  const hash = parsed.hash.slice(1);
  const fragment = parsed.hash ? `#${maskToken(hash)}` : "";

  return {
    text: `${parsed.protocol}//${auth}${host}${path}${query}${fragment}`,
    masked,
  };
};

/** `new URL(value).href`, or the value itself when it is not a URL */
const normalised = (value: string) => {
  try {
    return new URL(value).href;
  } catch {
    // Never the value, nor the error quoting it: an RPC URL often holds an API key
    log.info("an RPC URL does not parse, compared as written");
    return value;
  }
};

/**
 * The network chips Settings offers, each under its normalised address.
 * A custom RPC may use a chip's address under a name of its own (HOO-2690:
 * Devnet on a platform RPC, the public Devnet beside it); only a copy of a
 * chip, its name and its address, is refused. An endpoint a chip offers is
 * never adopted: its chip lists it already.
 */
const CHIPS: ReadonlyArray<CustomRpc> = offeredOf(CLUSTERS).map((c) => ({
  name: c.name,
  url: normalised(c.url),
}));

/**
 * The chips whose address an older `adopt` listed as a custom RPC, so a
 * profile may hold it re-spelled: Localnet, Surfpool and the Testnet chip,
 * all custom RPCs before they had chips (HOO-2707)
 */
const ADOPTED_CHIPS = offeredOf(CLUSTERS).filter(
  (c) => c.cluster === "localnet" || c.cluster === "testnet"
);

/**
 * The public Testnet, named as its cluster when saved with no name: a
 * custom RPC of its own once the Testnet chip is on a platform RPC
 */
const CLUSTER_NAMES = new Map<string, string>([
  [normalised(Endpoint.TESTNET), CLUSTERS.testnet.name],
]);

/**
 * A save's result: the stored RPC, a value refused before anything is
 * written (`format`; `duplicate`, an entry with this name and this URL
 * already, a chip or a saved RPC), or a write the browser refused (`storage`)
 */
export type SaveResult =
  | { ok: true; rpc: CustomRpc }
  | { ok: false; reason: "format" }
  | { ok: false; reason: "duplicate"; name: string }
  | { ok: false; reason: "storage" };

/** Why nothing was saved: a refusal, or a stored list that cannot be read */
export type Refused = Exclude<SaveResult, { ok: true }>;

/**
 * Whether two entries are one: the same name and the same URL. Either alone
 * may repeat, so the pair is what an edit or a remove names.
 */
export const isSameRpc = (a: CustomRpc, b: CustomRpc): boolean =>
  a.name === b.name && a.url === b.url;

/** A listed RPC's name when the user gave none: its cluster's, else its host */
const defaultName = (url: string) => CLUSTER_NAMES.get(url) ?? hostOf(url);

/** Name a stored or typed entry: trimmed, capped, a default when empty */
const nameOf = (name: string, url: string) =>
  // Trimmed again after the cap, so a name reads the same on every save
  name.trim().slice(0, RPC_NAME_MAX).trim() || defaultName(url);

/**
 * The stored list, keeping each valid RPC once; `undefined` when the stored
 * value cannot be read as a list, so no write lands over it. A dropped entry
 * is reported: the next write would lose it for good.
 */
const readStored = (): CustomRpc[] | undefined => {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (error) {
    log.warn("could not read the saved custom RPCs; reading none", {
      report: true,
      context: { error: String(error) },
    });
    return undefined;
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn("the saved custom RPCs are not JSON; reading none", {
      report: true,
    });
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    log.warn("the saved custom RPCs are not a list; reading none", {
      report: true,
    });
    return undefined;
  }
  const list: CustomRpc[] = [];
  // A copy of a chip is no loss: Localnet and the public Testnet were
  // listed as custom RPCs before they had chips of their own (HOO-2707)
  let copies = 0;
  for (const entry of parsed) {
    const { name, url } = (entry ?? {}) as { name?: unknown; url?: unknown };
    const check = typeof url === "string" ? checkRpcUrl(url) : undefined;
    if (!check?.ok) continue;
    const rpc = {
      name: nameOf(typeof name === "string" ? name : "", check.url),
      url: check.url,
    };
    const copy = (r: CustomRpc) => isSameRpc(r, rpc);
    if (CHIPS.some(copy)) {
      copies++;
      continue;
    }
    if (list.some(copy)) continue;
    list.push(rpc);
  }
  if (list.length + copies < parsed.length) {
    log.warn("dropped saved custom RPCs that are not valid", {
      report: true,
      context: { dropped: parsed.length - list.length - copies },
    });
  }
  return list;
};

/** The stored list to show; empty while it cannot be read */
const read = (): CustomRpc[] => readStored() ?? [];

const listeners = new Set<() => void>();

/** Store the list; false, reported, when the browser refuses */
const write = (list: CustomRpc[]): boolean => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (error) {
    log.warn("could not save the custom RPCs", {
      report: true,
      context: { error: String(error) },
    });
    return false;
  }
  listeners.forEach((cb) => cb());
  return true;
};

/**
 * Whether `input` may be saved over the entry `replacing` (a new one when
 * `undefined`): the URL rule, then no chip and no other saved RPC with both
 * its name and its URL. Any URL passes on its own, a chip's included.
 * Answers the entry as it would be saved; writes nothing.
 */
const checkSave = (
  input: CustomRpc,
  replacing: CustomRpc | undefined
): { ok: true; rpc: CustomRpc; list: CustomRpc[] } | Refused => {
  const url = checkRpcUrl(input.url);
  if (!url.ok) return url;
  const rpc = { name: nameOf(input.name, url.url), url: url.url };

  const chip = CHIPS.find((r) => isSameRpc(r, rpc));
  if (chip) return { ok: false, reason: "duplicate", name: chip.name };
  // A stored value that does not read as a list is left alone, never
  // replaced by a list holding only this entry
  const list = readStored();
  if (!list) return { ok: false, reason: "storage" };
  const taken = list.find(
    (r) => isSameRpc(r, rpc) && !(replacing && isSameRpc(r, replacing))
  );
  if (taken) return { ok: false, reason: "duplicate", name: taken.name };
  return { ok: true, rpc, list };
};

/**
 * Save `input` over the entry `replacing`, or as a new one when none is
 * saved as it (another tab may have removed it)
 */
const put = (
  input: CustomRpc,
  replacing: CustomRpc | undefined
): SaveResult => {
  const checked = checkSave(input, replacing);
  if (!checked.ok) return checked;
  const { list, rpc } = checked;

  const at = replacing ? list.findIndex((r) => isSameRpc(r, replacing)) : -1;
  if (at === -1) list.push(rpc);
  else list[at] = rpc;
  if (!write(list)) return { ok: false, reason: "storage" };
  return { ok: true, rpc };
};

/** The saved custom RPCs, kept in this browser under their own key */
export const PgCustomRpcs = {
  list: read,

  /**
   * Whether `save` (`replacing` undefined) or `replace` would take `input`,
   * without writing: the normalised URL, or the refusal they would answer.
   * The list may change before the save, which checks again.
   */
  check(
    input: CustomRpc,
    replacing: CustomRpc | undefined
  ): { ok: true; url: string } | Refused {
    const checked = checkSave(input, replacing);
    return checked.ok ? { ok: true, url: checked.rpc.url } : checked;
  },

  /** Save a new RPC; an empty name saves as `defaultName` gives it */
  save(input: CustomRpc): SaveResult {
    return put(input, undefined);
  },

  /** Replace the saved `rpc` in place, under the same rules */
  replace(rpc: CustomRpc, input: CustomRpc): SaveResult {
    return put(input, rpc);
  },

  /**
   * Remove the saved `rpc`, matched by name and URL. Answers it with its
   * index, for `restore`, or `undefined` when none is saved as it or the
   * browser refused the write.
   */
  remove(rpc: CustomRpc): { rpc: CustomRpc; index: number } | undefined {
    const list = readStored();
    if (!list) return undefined;
    const index = list.findIndex((r) => isSameRpc(r, rpc));
    if (index === -1) return undefined;
    const [removed] = list.splice(index, 1);
    return write(list) ? { rpc: removed, index } : undefined;
  },

  /**
   * Put a removed RPC back where it was, or last if the list shrank; false
   * when the browser refused the write
   */
  restore(rpc: CustomRpc, index: number): boolean {
    const stored = readStored();
    if (!stored) return false;
    const list = stored.filter((r) => !isSameRpc(r, rpc));
    list.splice(Math.min(index, list.length), 0, rpc);
    return write(list);
  },

  /**
   * List the connection's endpoint when nothing offers it, named by its
   * host (the public Testnet by its cluster), so a profile on a custom URL
   * from before, or one set elsewhere, sees it. Answers the URL it is listed
   * under, which may be spelled differently from `endpoint`: a local or
   * Testnet chip's address in another spelling that no saved RPC lists
   * answers the chip's own (`http://localhost:8899/`, adopted before
   * Localnet had a chip).
   * `undefined` when a chip offers the endpoint as it is, or it is not an
   * RPC we would save.
   */
  adopt(endpoint: string): string | undefined {
    const check = checkRpcUrl(endpoint);
    if (!check.ok) return undefined;
    // Opening Settings must not write over a list that does not read
    const list = readStored();
    if (!list) return undefined;
    if (CHIPS.some((r) => r.url === check.url)) {
      const local = ADOPTED_CHIPS.find((c) => normalised(c.url) === check.url);
      const respell =
        local &&
        local.url !== endpoint &&
        !list.some((r) => r.url === check.url);
      return respell ? local.url : undefined;
    }
    if (list.some((r) => r.url === check.url)) return check.url;
    return write([...list, { name: defaultName(check.url), url: check.url }])
      ? check.url
      : undefined;
  },

  /**
   * The network chip picked or saved last, as the Network row keys it, so
   * it stays checked after a reload when other chips share its URL;
   * `undefined` when none is stored or it cannot be read
   */
  chosen(): string | undefined {
    try {
      return localStorage.getItem(CHOSEN_KEY) ?? undefined;
    } catch (error) {
      log.warn("could not read the picked network chip", {
        context: { error: String(error) },
      });
      return undefined;
    }
  },

  /** Store the chip picked last; a refused write only loses it on reload */
  choose(key: string): void {
    try {
      localStorage.setItem(CHOSEN_KEY, key);
    } catch (error) {
      log.warn("could not store the picked network chip", {
        context: { error: String(error) },
      });
    }
  },

  /** Fires on every change, this tab's or another's, a `clear()` included */
  onDidChange(cb: () => void): { dispose(): void } {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === KEY || ev.key === null) cb();
    };
    listeners.add(cb);
    window.addEventListener("storage", onStorage);
    return {
      dispose: () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      },
    };
  },
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach, afterEach, vi } = import.meta
    .vitest;

  /** The offered network under `key`, wherever the list puts it */
  const offered = (key: string) => {
    const chip = offeredOf(CLUSTERS).find((c) => c.key === key);
    if (!chip) throw new Error(`No offered network ${key}`);
    return { name: chip.name, value: chip.url };
  };

  describe("entities/cluster/model/custom-rpcs", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    const add = (name: string, url: string) => PgCustomRpcs.save({ name, url });

    /** The saved entry named `name` */
    const at = (name: string): CustomRpc => {
      const rpc = PgCustomRpcs.list().find((r) => r.name === name);
      if (!rpc) throw new Error(`not listed: ${name}`);
      return rpc;
    };

    /** Remove, then restore, as the toast's Undo does */
    const removeAndRestore = (url: string) => {
      const removed = PgCustomRpcs.remove(
        PgCustomRpcs.list().find((r) => r.url === url) ?? { name: "", url }
      );
      if (!removed) throw new Error(`not listed: ${url}`);
      PgCustomRpcs.restore(removed.rpc, removed.index);
    };

    describe("checkRpcUrl", () => {
      it.each([
        "devnet",
        Endpoint.DEVNET.replace("https:", "http:"),
        // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- the insecure scheme is the input under test
        "ftp://rpc.test",
        "",
        "https://",
      ])("refuses %j", (value) => {
        expect(checkRpcUrl(value)).toEqual({ ok: false, reason: "format" });
      });

      it.each([
        ["https://rpc.example.com", "https://rpc.example.com/"],
        ["http://localhost:8899", "http://localhost:8899/"],
        ["http://127.0.0.1:8899", "http://127.0.0.1:8899/"],
        [
          "  https://rpc.example.com/v1?k=1  ",
          "https://rpc.example.com/v1?k=1",
        ],
      ])("accepts %j as %j", (value, url) => {
        expect(checkRpcUrl(value)).toEqual({ ok: true, url });
      });
    });

    it("returns the host alone from hostOf, port included, never the path or query", () => {
      expect(hostOf("https://rpc.example.com/v1/key?api-key=s")).toBe(
        "rpc.example.com"
      );
      expect(hostOf("http://localhost:8899/")).toBe("localhost:8899");
    });

    describe("maskRpcUrl", () => {
      it.each([
        [
          "https://devnet.helius-rpc.com/?api-key=abc",
          "https://devnet.helius-rpc.com/?api-key=••••",
        ],
        [
          "https://r.test/?apiKey=x&cluster=devnet",
          "https://r.test/?apiKey=••••&cluster=devnet",
        ],
        ["https://r.test/?access_token=x", "https://r.test/?access_token=••••"],
        [
          "https://solana-mainnet.g.alchemy.com/v2/abc123def456ghi789",
          "https://solana-mainnet.g.alchemy.com/v2/••••",
        ],
        [
          "https://x.solana-mainnet.quiknode.pro/0123456789abcdef0123456789abcdef01234567/",
          "https://x.solana-mainnet.quiknode.pro/••••/",
        ],
        [
          "https://rpc.ankr.com/solana/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          "https://rpc.ankr.com/solana/••••",
        ],
        ["https://r.test/?id=a1b2c3d4e5f6g7h8i9", "https://r.test/?id=••••"],
        ["https://user:pass@r.test/", "https://••••@r.test/"],
        ["https://r.test/#a1b2c3d4e5f6g7h8i9", "https://r.test/#••••"],
        ["https://r.test/?a1b2c3d4e5f6g7h8i9", "https://r.test/?••••"],
        // Every key-like name, each with a value too short to be a token
        ["https://r.test/?secret=x", "https://r.test/?secret=••••"],
        ["https://r.test/?auth=x", "https://r.test/?auth=••••"],
        ["https://r.test/?passphrase=x", "https://r.test/?passphrase=••••"],
        ["https://r.test/?sig=x", "https://r.test/?sig=••••"],
        ["https://r.test/?credential=x", "https://r.test/?credential=••••"],
        // A token at the 16-character floor, and in other spellings
        ["https://r.test/a1b2c3d4e5f6g7h8", "https://r.test/••••"],
        ["https://r.test/eyJhbGciOi.eyJzdWIiOjF9.c2ln", "https://r.test/••••"],
        ["https://r.test/?id=ab%2Bcd%3D1234567890", "https://r.test/?id=••••"],
        [
          "https://r.test/v2/AbCdEfGhIjKlMnOpQrStUvWxYz",
          "https://r.test/v2/••••",
        ],
        // A token in the subdomain; the port stays
        [
          "https://a1b2c3d4e5f6g7h8i9.rpc.test:8443/",
          "https://••••.rpc.test:8443/",
        ],
        // A username alone, a password alone, and with a port
        ["https://TOKEN@r.test/", "https://••••@r.test/"],
        ["https://:pw@r.test/", "https://••••@r.test/"],
        ["https://u:p@r.test:8899/", "https://••••@r.test:8899/"],
        // A token path beside a key-named query
        [
          "https://r.test/a1b2c3d4e5f6g7h8i9/?api-key=k",
          "https://r.test/••••/?api-key=••••",
        ],
      ])("masks the key in %s", (url, text) => {
        expect(maskRpcUrl(url)).toEqual({ text, masked: true });
      });

      it.each([
        `${Endpoint.DEVNET}/`,
        "http://localhost:8899/",
        "https://r.test/solana-mainnet-endpoint/?cluster=devnet",
        // One short of the token floor, and long words with no digit
        "https://r.test/a1b2c3d4e5f6g7h",
        "https://r.test/solana-mainnet-endpoint-beta/",
        // A key-like name with nothing in it, and a plain fragment
        "https://r.test/?api-key=",
        "https://r.test/#section",
        "http://[::1]:8899/",
      ])("shows %s in full", (url) => {
        expect(maskRpcUrl(url)).toEqual({ text: url, masked: false });
      });

      it("draws a stored value that is not a URL fully masked", () => {
        expect(maskRpcUrl("not a url s3cr3t")).toEqual({
          text: "••••",
          masked: true,
        });
      });

      it("never draws the key's length", () => {
        expect(maskRpcUrl("https://r.test/?key=a").text).toBe(
          maskRpcUrl("https://r.test/?key=abcdefghijklmnopqrstuvwxyz").text
        );
      });
    });

    it("saves an unnamed RPC under its host", () => {
      const saved = add("", "https://rpc.example.com/v1/k");
      expect(saved).toEqual({
        ok: true,
        rpc: { name: "rpc.example.com", url: "https://rpc.example.com/v1/k" },
      });
      expect(PgCustomRpcs.list()).toEqual([
        { name: "rpc.example.com", url: "https://rpc.example.com/v1/k" },
      ]);
    });

    it("trims a name and keeps at most 32 characters of it", () => {
      add(`  ${"x".repeat(40)}  `, "https://a.test");
      expect(PgCustomRpcs.list()[0].name).toBe("x".repeat(32));
    });

    it("trims a name again after the cap, so the same name is refused as a copy", () => {
      const name = `${"x".repeat(31)} y`;
      expect(add(name, "https://a.test").ok).toBe(true);
      expect(PgCustomRpcs.list()[0].name).toBe("x".repeat(31));
      expect(add(name, "https://a.test")).toMatchObject({
        reason: "duplicate",
      });
    });

    it("refuses a URL that fails the rule, and saves nothing", () => {
      expect(add("", Endpoint.DEVNET.replace("https:", "http:"))).toEqual({
        ok: false,
        reason: "format",
      });
      expect(PgCustomRpcs.list()).toEqual([]);
    });

    it("refuses an entry already saved, its name and its URL compared as a URL", () => {
      add("Helius", "https://rpc.example.com/");
      expect(add(" Helius ", "https://RPC.example.com")).toEqual({
        ok: false,
        reason: "duplicate",
        name: "Helius",
      });
      add("", "https://b.test");
      expect(add("", "https://B.test/")).toEqual({
        ok: false,
        reason: "duplicate",
        name: "b.test",
      });
    });

    it("saves a URL already saved under another name, and a name under another URL", () => {
      add("Helius", "https://rpc.example.com/");
      expect(add("Helius backup", "https://rpc.example.com").ok).toBe(true);
      expect(add("Helius", "https://other.example.com").ok).toBe(true);
      expect(PgCustomRpcs.list()).toEqual([
        { name: "Helius", url: "https://rpc.example.com/" },
        { name: "Helius backup", url: "https://rpc.example.com/" },
        { name: "Helius", url: "https://other.example.com/" },
      ]);
    });

    it("keeps the order of saving, and persists across a fresh read", () => {
      add("A", "https://a.test");
      add("B", "https://b.test");
      const raw = JSON.parse(localStorage.getItem("customRpcs") ?? "null");
      expect(raw).toEqual([
        { name: "A", url: "https://a.test/" },
        { name: "B", url: "https://b.test/" },
      ]);
      expect(PgCustomRpcs.list().map((r) => r.name)).toEqual(["A", "B"]);
    });

    it("replaces an edited entry in place", () => {
      add("A", "https://a.test");
      add("B", "https://b.test");
      const edited = PgCustomRpcs.replace(at("A"), {
        name: "A2",
        url: "https://a2.test",
      });
      expect(edited.ok).toBe(true);
      expect(PgCustomRpcs.list()).toEqual([
        { name: "A2", url: "https://a2.test/" },
        { name: "B", url: "https://b.test/" },
      ]);
    });

    it("lets an edit keep itself, take another's URL, but not become another entry", () => {
      add("A", "https://a.test");
      add("B", "https://b.test");
      expect(
        PgCustomRpcs.replace(at("A"), { name: "A", url: "https://a.test" }).ok
      ).toBe(true);
      expect(
        PgCustomRpcs.replace(at("A"), { name: "A", url: "https://b.test" }).ok
      ).toBe(true);
      expect(
        PgCustomRpcs.replace(at("A"), { name: "B", url: "https://b.test" })
      ).toEqual({ ok: false, reason: "duplicate", name: "B" });
      expect(PgCustomRpcs.list()).toEqual([
        { name: "A", url: "https://b.test/" },
        { name: "B", url: "https://b.test/" },
      ]);
    });

    it("edits and removes the entry named, when another shares its URL", () => {
      add("A", "https://same.test");
      add("B", "https://same.test");
      PgCustomRpcs.replace(at("B"), { name: "B2", url: "https://same.test" });
      expect(PgCustomRpcs.remove(at("A"))).toEqual({
        rpc: { name: "A", url: "https://same.test/" },
        index: 0,
      });
      expect(PgCustomRpcs.list()).toEqual([
        { name: "B2", url: "https://same.test/" },
      ]);
    });

    it("restores a removed entry where it was", () => {
      add("A", "https://a.test");
      add("B", "https://b.test");
      add("C", "https://c.test");
      const before = PgCustomRpcs.list();
      expect(PgCustomRpcs.remove(at("B"))).toEqual({
        rpc: { name: "B", url: "https://b.test/" },
        index: 1,
      });
      expect(PgCustomRpcs.list().map((r) => r.name)).toEqual(["A", "C"]);
      PgCustomRpcs.restore({ name: "B", url: "https://b.test/" }, 1);
      expect(PgCustomRpcs.list()).toEqual(before);
    });

    describe("check", () => {
      it("answers the normalised URL of a value save would take, writing nothing", () => {
        expect(
          PgCustomRpcs.check({ name: "", url: "https://A.test" }, undefined)
        ).toEqual({ ok: true, url: "https://a.test/" });
        expect(PgCustomRpcs.list()).toEqual([]);
      });

      it("refuses as save would: the URL rule, a copy of a chip, of another saved RPC", () => {
        add("A", "https://a.test");
        expect(
          PgCustomRpcs.check({ name: "", url: "devnet" }, undefined)
        ).toEqual({ ok: false, reason: "format" });
        expect(
          PgCustomRpcs.check(
            {
              name: offered("mainnet").name,
              url: offered("mainnet").value,
            },
            undefined
          )
        ).toEqual({ ok: false, reason: "duplicate", name: "Mainnet" });
        expect(
          PgCustomRpcs.check({ name: "A", url: "https://a.test" }, undefined)
        ).toEqual({ ok: false, reason: "duplicate", name: "A" });
      });

      it("lets an edit keep itself", () => {
        add("A", "https://a.test");
        expect(
          PgCustomRpcs.check({ name: "A", url: "https://a.test" }, at("A"))
        ).toEqual({ ok: true, url: "https://a.test/" });
      });
    });

    it("keeps the chip picked last across a fresh read", () => {
      expect(PgCustomRpcs.chosen()).toBeUndefined();
      PgCustomRpcs.choose("Mine\nhttps://a.test/");
      expect(PgCustomRpcs.chosen()).toBe("Mine\nhttps://a.test/");
    });

    it("answers undefined when removing a URL that is not listed", () => {
      expect(
        PgCustomRpcs.remove({ name: "none", url: "https://none.test/" })
      ).toBeUndefined();
    });

    it.each([
      ["not json", []],
      ["{}", []],
      [
        '[{"url":1},{"name":"a","url":"https://a.test"},{"name":"b","url":"devnet"}]',
        [{ name: "a", url: "https://a.test/" }],
      ],
    ])("reads a stored %j as the valid entries only", (raw, list) => {
      localStorage.setItem("customRpcs", raw);
      expect(PgCustomRpcs.list()).toEqual(list);
    });

    describe("a stored list that does not read", () => {
      it("is never written over, by an adopt or a save", () => {
        localStorage.setItem(KEY, "not json");
        expect(PgCustomRpcs.adopt("https://own.test")).toBeUndefined();
        expect(
          PgCustomRpcs.save({ name: "", url: "https://own.test" })
        ).toEqual({ ok: false, reason: "storage" });
        expect(localStorage.getItem(KEY)).toBe("not json");
      });
    });

    describe("adopt", () => {
      it("lists a custom endpoint under its host, once, and answers its URL", () => {
        expect(PgCustomRpcs.adopt("https://own.test/?k=1")).toBe(
          "https://own.test/?k=1"
        );
        expect(PgCustomRpcs.adopt("https://own.test/?k=1")).toBe(
          "https://own.test/?k=1"
        );
        expect(PgCustomRpcs.list()).toEqual([
          { name: "own.test", url: "https://own.test/?k=1" },
        ]);
      });

      it("answers the listed spelling of an endpoint written another way", () => {
        expect(PgCustomRpcs.adopt("https://own.test")).toBe(
          "https://own.test/"
        );
        add("Own", "https://own.test/");
        expect(PgCustomRpcs.adopt("https://OWN.test")).toBe(
          "https://own.test/"
        );
      });

      it("moves a profile on Localnet's address, adopted before it had a chip, onto the chip", () => {
        localStorage.setItem(
          "customRpcs",
          JSON.stringify([{ name: "Localnet", url: "http://localhost:8899/" }])
        );
        expect(PgCustomRpcs.adopt("http://localhost:8899/")).toBe(
          "http://localhost:8899"
        );
        expect(PgCustomRpcs.list()).toEqual([]);
      });

      it.each([
        { name: "Surfpool", chip: "http://127.0.0.1:8899" },
        { name: "the public Testnet", chip: Endpoint.TESTNET },
      ])(
        "moves a profile on $name's address, re-spelled, onto its chip",
        ({ chip }) => {
          expect(PgCustomRpcs.adopt(`${chip}/`)).toBe(chip);
        }
      );

      it("keeps a profile on a chip's address re-spelled when a saved RPC lists it", () => {
        add("My local", "http://localhost:8899/");
        expect(PgCustomRpcs.adopt("http://localhost:8899/")).toBeUndefined();
        expect(PgCustomRpcs.list().map((r) => r.name)).toEqual(["My local"]);
      });

      it("still reports a lost entry beside a dropped copy of a chip", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        localStorage.setItem(
          "customRpcs",
          JSON.stringify([
            { name: "Localnet", url: "http://localhost:8899" },
            { name: "Broken", url: "not a url" },
          ])
        );
        expect(PgCustomRpcs.list()).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls[0])).toContain('"dropped":1');
        warn.mockRestore();
      });

      it("drops an adopted copy of a chip without reporting it", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        localStorage.setItem(
          "customRpcs",
          JSON.stringify([{ name: "Localnet", url: "http://localhost:8899" }])
        );
        expect(PgCustomRpcs.list()).toEqual([]);
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
      });

      it("leaves an endpoint out when a saved RPC lists it, under any name", () => {
        add("Mine", "https://own.test");
        expect(PgCustomRpcs.adopt("https://own.test")).toBe(
          "https://own.test/"
        );
        expect(PgCustomRpcs.list()).toHaveLength(1);
      });

      it.each([
        ["the offered Devnet", () => offered("devnet").value],
        ["the offered Mainnet", () => offered("mainnet").value],
        ["the offered Testnet", () => offered("testnet").value],
        ["Localnet", () => "http://localhost:8899"],
        ["Surfpool", () => "http://127.0.0.1:8899"],
        // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- Endpoint.PLAYNET's placeholder, matched by name and never requested
        ["Playnet", () => "http://playnet"],
        ["a value that is not an RPC", () => "devnet"],
      ])("leaves %s out", (_, endpoint) => {
        expect(PgCustomRpcs.adopt(endpoint())).toBeUndefined();
        expect(PgCustomRpcs.list()).toEqual([]);
      });
    });

    it("saves a chip's address under a name of its own, and the public Devnet beside Devnet", () => {
      expect(add("My Devnet", offered("devnet").value).ok).toBe(true);
      expect(add("", offered("mainnet").value).ok).toBe(true);
      expect(add("Public Devnet", Endpoint.DEVNET).ok).toBe(true);
      expect(PgCustomRpcs.list().map((r) => r.name)).toEqual([
        "My Devnet",
        hostOf(offered("mainnet").value),
        "Public Devnet",
      ]);
    });

    it("refuses a copy of a chip, its name and its address, naming its network", () => {
      expect(add("Devnet", offered("devnet").value)).toEqual({
        ok: false,
        reason: "duplicate",
        name: "Devnet",
      });
    });

    it("drops a stored copy of a chip, and keeps its address under another name", () => {
      localStorage.setItem(
        "customRpcs",
        JSON.stringify([
          { name: "Mine", url: offered("devnet").value },
          { name: "Devnet", url: offered("devnet").value },
        ])
      );
      expect(PgCustomRpcs.list()).toEqual([
        { name: "Mine", url: new URL(offered("devnet").value).href },
      ]);
    });

    it("reads stored names trimmed, capped and never empty, and each entry once", () => {
      localStorage.setItem(
        "customRpcs",
        JSON.stringify([
          { name: "  ", url: "https://a.test" },
          { name: "x".repeat(40), url: "https://b.test" },
          { name: "again", url: "https://A.test/" },
          { name: "a.test", url: "https://A.test/" },
        ])
      );
      expect(PgCustomRpcs.list()).toEqual([
        { name: "a.test", url: "https://a.test/" },
        { name: "x".repeat(32), url: "https://b.test/" },
        { name: "again", url: "https://a.test/" },
      ]);
    });

    describe("when the browser refuses storage", () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("refuses a save, and tells no listener", () => {
        const cb = vi.fn();
        const sub = PgCustomRpcs.onDidChange(cb);
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new DOMException("full", "QuotaExceededError");
        });
        expect(add("A", "https://a.test")).toEqual({
          ok: false,
          reason: "storage",
        });
        expect(cb).not.toHaveBeenCalled();
        sub.dispose();
      });

      it("keeps a remove that could not be written undone", () => {
        add("A", "https://a.test");
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new DOMException("full", "QuotaExceededError");
        });
        expect(PgCustomRpcs.remove(at("A"))).toBeUndefined();
      });

      it("reads none when reading throws", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
          throw new DOMException("blocked", "SecurityError");
        });
        expect(PgCustomRpcs.list()).toEqual([]);
      });
    });

    it("tells listeners about every change, and stops when disposed", () => {
      const cb = vi.fn();
      const sub = PgCustomRpcs.onDidChange(cb);
      add("A", "https://a.test");
      removeAndRestore("https://a.test/");
      expect(cb).toHaveBeenCalledTimes(3);
      sub.dispose();
      add("B", "https://b.test");
      expect(cb).toHaveBeenCalledTimes(3);
    });

    it("tells listeners when another tab writes the list", () => {
      const cb = vi.fn();
      const sub = PgCustomRpcs.onDidChange(cb);
      window.dispatchEvent(new StorageEvent("storage", { key: "customRpcs" }));
      window.dispatchEvent(new StorageEvent("storage", { key: "settings" }));
      // Another tab's `localStorage.clear()`: the event's key is null
      // eslint-disable-next-line unicorn/no-null -- the DOM's StorageEvent shape
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      expect(cb).toHaveBeenCalledTimes(2);
      sub.dispose();
    });
  });
}
