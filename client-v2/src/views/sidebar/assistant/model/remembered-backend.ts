import { createLogger } from "@/shared/lib/logger";
import type { ModelProvider } from "@/shared/lib/ai";
import type { Connection } from "../store";
import { REMEMBERED_BACKEND_KEY } from "./remembered-backend-key";
import { PROVIDERS } from "./types";

export { REMEMBERED_BACKEND_KEY } from "./remembered-backend-key";

/**
 * Which backend to reconnect to on the next load.
 *
 * Two answers in two stores. The keyless default backend is remembered by id
 * in `localStorage`, across tabs and restarts: nothing secret is written.
 * A backend that needs the user's own key is remembered whole, key included,
 * in `sessionStorage`, which is kept per tab: a new tab starts without it,
 * while a tab the browser duplicates or restores (a reopened closed tab, a
 * restored session) carries it and reconnects, as after a reload. Project
 * code runs in this origin and can read either store; `sessionStorage` bounds
 * that to the tab the user is already working in. See the design in
 * `openspec/changes/archive/2026-10-15-assistant-own-key-storage/design.md`
 * (HOO-1748).
 *
 * Every access is guarded. Storage throws rather than returning `null` with
 * site data blocked, and the panel has to open either way. A failure is
 * logged by what was attempted, never with the value.
 */
const CONNECTION_KEY = "assistant.connection";

const DEFAULT_ID: ModelProvider = "default";

const log = createLogger("assistant:remembered-backend");

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.name : "unknown";

/**
 * Run a storage access, read or write, answering `fallback` (and logging why)
 * if it throws
 */
const guarded = <T>(what: string, run: () => T, fallback: T): T => {
  try {
    return run();
  } catch (error) {
    // Expected with site data blocked, so not reported; the panel asks again
    log.warn(`could not ${what}`, { context: { reason: reasonOf(error) } });
    return fallback;
  }
};

/** Run a storage write, answering whether it went through */
const attempt = (what: string, run: () => void) =>
  guarded(
    what,
    () => {
      run();
      return true;
    },
    false
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Every field of a `Connection`, none optional, so the copies below must name
 * each one: a field added to `Connection` fails the build here until it is
 * written and read back, instead of being dropped on a reload.
 */
type StoredConnection = { [K in keyof Required<Connection>]: Connection[K] };

/** The connection as it is written to `sessionStorage` */
const toStored = (connection: Connection): string => {
  const stored: StoredConnection = {
    id: connection.id,
    apiKey: connection.apiKey,
    endpoint: connection.endpoint && {
      baseUrl: connection.endpoint.baseUrl,
      model: connection.endpoint.model,
    },
    settings: connection.settings && {
      model: connection.settings.model,
      effort: connection.settings.effort,
    },
  };
  // `JSON.stringify` leaves out the fields that are `undefined`
  return JSON.stringify(stored);
};

/**
 * Why a kept connection was dropped. Logged in its place, since the value
 * itself carries the key.
 */
type DropReason =
  /** The entry `dropKept` leaves when it cannot remove one */
  | "blank"
  | "not-json"
  | "not-an-object"
  /** A provider this build no longer has */
  | "unknown-provider"
  /** The keyless default, which is remembered in `localStorage` instead */
  | "default-backend"
  /** Missing, or blank for a provider whose key is not optional */
  | "no-key"
  /** Missing or malformed where needed, or present where there is none */
  | "bad-endpoint"
  /** Malformed, or an effort the provider does not offer */
  | "bad-settings";

type ReadBack =
  | { connection: Connection; reason?: never }
  | { connection?: never; reason: DropReason };

const dropped = (reason: DropReason): ReadBack => ({ reason });

/** A stored connection, rebuilt field by field so nothing unknown rides along */
const fromStored = (raw: string): ReadBack => {
  if (raw === "") return dropped("blank");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not rethrown: the caller drops the entry and logs this reason
    return dropped("not-json");
  }
  if (!isRecord(parsed)) return dropped("not-an-object");

  const { id, apiKey } = parsed;
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) return dropped("unknown-provider");
  if (provider.id === DEFAULT_ID) return dropped("default-backend");

  if (typeof apiKey !== "string") return dropped("no-key");
  if (!apiKey.trim() && !provider.keyOptional) return dropped("no-key");

  let endpoint: Connection["endpoint"];
  if (provider.endpoint) {
    // An OpenAI-compatible provider cannot talk without its base URL and model
    const stored = parsed.endpoint;
    if (
      !isRecord(stored) ||
      typeof stored.baseUrl !== "string" ||
      typeof stored.model !== "string"
    ) {
      return dropped("bad-endpoint");
    }
    endpoint = { baseUrl: stored.baseUrl, model: stored.model };
  } else if (parsed.endpoint !== undefined) {
    return dropped("bad-endpoint");
  }

  let settings: Connection["settings"];
  if (parsed.settings !== undefined) {
    const stored = parsed.settings;
    if (!isRecord(stored) || typeof stored.model !== "string") {
      return dropped("bad-settings");
    }
    const effort = provider.modelSettings?.efforts.find(
      (e) => e === stored.effort
    );
    if (!effort) return dropped("bad-settings");
    settings = { model: stored.model, effort };
  }

  const connection: StoredConnection = {
    id: provider.id,
    apiKey,
    endpoint,
    settings,
  };
  return { connection };
};

/**
 * Remove the kept connection, the one way every path that must lose the key
 * does it. If the removal throws, the entry is blanked instead: `fromStored`
 * drops a blank one, so the next read forgets it.
 *
 * Reported only when the key verifiably survived both, which is a privacy
 * failure the team must hear about. Storage that refuses everything (site
 * data blocked) fails the read-back too; then nothing was ever written, and
 * it is only logged.
 *
 * @returns whether the key is gone from this tab's storage
 */
const dropKept = (what: string) => {
  if (attempt(what, () => sessionStorage.removeItem(CONNECTION_KEY))) {
    return true;
  }
  attempt("blank the key", () => sessionStorage.setItem(CONNECTION_KEY, ""));

  const left = guarded(
    "check the key is gone",
    () => sessionStorage.getItem(CONNECTION_KEY),
    null
  );
  if (!left) return true;

  log.error(new Error("could not forget the key kept for this tab"), {
    report: true,
  });
  return false;
};

/**
 * Record the user's choice, so a later load can reconnect to it: the default
 * in any tab of this browser, a key-based backend only in this tab.
 */
export const rememberBackend = (connection: Connection) => {
  // Written down as a whole id rather than a flag, so switching to a
  // key-based backend overwrites it instead of leaving a stale `true` behind
  attempt("remember the backend", () =>
    localStorage.setItem(REMEMBERED_BACKEND_KEY, connection.id)
  );

  if (connection.id === DEFAULT_ID) {
    dropKept("forget the previous key");
    return;
  }

  const kept = attempt("keep the connection for this tab", () =>
    sessionStorage.setItem(CONNECTION_KEY, toStored(connection))
  );
  if (kept) return;

  // The write failed, so an earlier backend's key may still be there and a
  // reload would reconnect to it instead of the one just chosen. Dropping it
  // makes the next load ask.
  dropKept("drop the previous connection");
};

/**
 * Drop both. Disconnecting is the user saying not to reconnect.
 *
 * @returns whether the key is gone, so the caller can tell the user when it
 * is not
 */
export const forgetBackend = () => {
  attempt("forget the backend", () =>
    localStorage.removeItem(REMEMBERED_BACKEND_KEY)
  );
  return dropKept("forget the key");
};

/** Whether this browser should reconnect to the default backend by itself */
export const isDefaultBackendRemembered = () =>
  guarded(
    "read the remembered backend",
    () => localStorage.getItem(REMEMBERED_BACKEND_KEY) === DEFAULT_ID,
    false
  );

/** The key-based connection this tab was using before a reload, if any */
export const rememberedConnection = (): Connection | null => {
  const raw = guarded(
    "read the connection kept for this tab",
    () => sessionStorage.getItem(CONNECTION_KEY),
    null
  );
  if (raw === null) return null;

  const { connection, reason } = fromStored(raw);
  if (connection) return connection;

  log.warn("dropped a kept connection this build cannot use", {
    context: { reason },
  });
  dropKept("drop the unusable connection");
  return null;
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, beforeEach, afterEach } =
    import.meta.vitest;
  describe("views/sidebar/assistant/model/remembered-backend", () => {
    let initLogger: typeof import("@/shared/lib/logger").initLogger;
    let memoryProvider: typeof import("@/shared/lib/logger").memoryProvider;
    let resetLogger: typeof import("@/shared/lib/logger").resetLogger;
    let storedValues: typeof import("../../../../test-utils/stored-values").storedValues;
    beforeAll(async () => {
      ({ initLogger, memoryProvider, resetLogger } = await import(
        "@/shared/lib/logger"
      ));
      ({ storedValues } = await import("../../../../test-utils/stored-values"));
    });
    const KEY = "sk-test-0123456789";

    const openai: Connection = {
      id: "openai",
      apiKey: KEY,
      endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
    };
    const anthropic: Connection = {
      id: "anthropic",
      apiKey: KEY,
      settings: { model: "claude-opus-5", effort: "high" },
    };
    const defaultBackend: Connection = { id: "default", apiKey: "" };

    describe("remembered backend", () => {
      beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      afterEach(() => {
        vi.restoreAllMocks();
        resetLogger();
      });

      it("remembers nothing until a backend has been chosen", () => {
        expect(isDefaultBackendRemembered()).toBe(false);
        expect(rememberedConnection()).toBeNull();
      });

      it("remembers the default backend in localStorage only", () => {
        rememberBackend(defaultBackend);
        expect(isDefaultBackendRemembered()).toBe(true);
        expect(rememberedConnection()).toBeNull();
      });

      it("keeps a key-based connection for this tab", () => {
        rememberBackend(openai);
        expect(rememberedConnection()).toEqual(openai);
        expect(isDefaultBackendRemembered()).toBe(false);
      });

      it("keeps model settings for a backend without a base URL", () => {
        rememberBackend(anthropic);
        expect(rememberedConnection()).toEqual(anthropic);
      });

      it("never writes the key to localStorage", () => {
        rememberBackend(openai);
        expect(JSON.stringify(storedValues(localStorage))).not.toContain(KEY);
      });

      it("drops the key once the default backend is chosen", () => {
        rememberBackend(openai);
        rememberBackend(defaultBackend);
        expect(rememberedConnection()).toBeNull();
        expect(sessionStorage.length).toBe(0);
      });

      it("forgets both on request", () => {
        rememberBackend(defaultBackend);
        rememberBackend(openai);
        expect(forgetBackend()).toBe(true);
        expect(isDefaultBackendRemembered()).toBe(false);
        expect(rememberedConnection()).toBeNull();
        expect(sessionStorage.length).toBe(0);
      });

      it.each([
        ["not JSON", "{", "not-json"],
        ["a blanked entry", "", "blank"],
        ["a JSON value that is not an object", "42", "not-an-object"],
        ["JSON null", "null", "not-an-object"],
        [
          "an unknown provider",
          JSON.stringify({ id: "nope", apiKey: KEY }),
          "unknown-provider",
        ],
        [
          "the default backend",
          JSON.stringify({ id: "default", apiKey: "" }),
          "default-backend",
        ],
        ["no key", JSON.stringify({ id: "openai" }), "no-key"],
        [
          "a blank key for a provider that needs one",
          JSON.stringify({
            id: "anthropic",
            apiKey: " ",
            settings: anthropic.settings,
          }),
          "no-key",
        ],
        [
          "an OpenAI-compatible provider with no endpoint",
          JSON.stringify({ id: "openai", apiKey: KEY }),
          "bad-endpoint",
        ],
        [
          "a half endpoint",
          JSON.stringify({
            id: "openai",
            apiKey: KEY,
            endpoint: { baseUrl: "x" },
          }),
          "bad-endpoint",
        ],
        [
          "an endpoint for a provider that has none",
          JSON.stringify({
            id: "anthropic",
            apiKey: KEY,
            endpoint: openai.endpoint,
            settings: anthropic.settings,
          }),
          "bad-endpoint",
        ],
        [
          "settings without a string model",
          JSON.stringify({
            id: "anthropic",
            apiKey: KEY,
            settings: { model: 5, effort: "high" },
          }),
          "bad-settings",
        ],
        [
          "an effort the provider does not offer",
          JSON.stringify({
            id: "anthropic",
            apiKey: KEY,
            settings: { model: "m", effort: "turbo" },
          }),
          "bad-settings",
        ],
      ])("drops a stored value with %s", (_, raw, reason) => {
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        sessionStorage.setItem("assistant.connection", raw);

        expect(rememberedConnection()).toBeNull();
        expect(sessionStorage.getItem("assistant.connection")).toBeNull();
        // Why it was dropped, and never the value it was dropped for
        expect(logged.entries).toContainEqual(
          expect.objectContaining({ context: { reason } })
        );
        expect(JSON.stringify(logged.entries)).not.toContain(KEY);
      });

      it("keeps a blank key for a provider whose key is optional", () => {
        const proxy: Connection = {
          id: "openai",
          apiKey: "",
          endpoint: { baseUrl: "http://localhost:4000/v1", model: "local" },
        };
        rememberBackend(proxy);
        expect(rememberedConnection()).toEqual(proxy);
      });

      it("carries no field it does not know", () => {
        sessionStorage.setItem(
          "assistant.connection",
          JSON.stringify({
            id: "openai",
            apiKey: KEY,
            endpoint: openai.endpoint,
            extra: 1,
          })
        );
        expect(rememberedConnection()).toEqual(openai);
      });

      it("answers no when storage refuses to say", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
          throw new Error("SecurityError");
        });
        expect(isDefaultBackendRemembered()).toBe(false);
        expect(rememberedConnection()).toBeNull();
      });

      it("logs a refused write without the key", () => {
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new Error("QuotaExceededError");
        });

        expect(() => rememberBackend(openai)).not.toThrow();

        expect(logged.entries.length).toBeGreaterThan(0);
        for (const entry of logged.entries) {
          expect(entry).toMatchObject({
            ns: "assistant:remembered-backend",
            report: false,
          });
        }
        expect(JSON.stringify(logged.entries)).not.toContain(KEY);
      });

      type StorageMethod = "getItem" | "setItem" | "removeItem";

      /** Make the given Storage methods throw for `sessionStorage` only */
      const failOnSession = (...methods: StorageMethod[]) => {
        for (const method of methods) {
          const original = Storage.prototype[method] as (
            ...args: string[]
          ) => unknown;
          vi.spyOn(Storage.prototype, method).mockImplementation(function (
            this: Storage,
            ...args: string[]
          ) {
            if (this === sessionStorage) throw new Error("blocked");
            return original.apply(this, args);
          } as never);
        }
      };

      /** Log entries meant for error tracking */
      const reported = (logged: ReturnType<typeof memoryProvider>) =>
        logged.entries.filter((e) => e.report);

      it("does not leave an earlier key behind when the new one cannot be kept", () => {
        rememberBackend(openai);
        failOnSession("setItem");

        rememberBackend(anthropic);

        expect(rememberedConnection()).toBeNull();
      });

      it("does not leave the key behind when the default cannot remove it", () => {
        rememberBackend(openai);
        failOnSession("removeItem");

        rememberBackend(defaultBackend);

        expect(rememberedConnection()).toBeNull();
      });

      it("blanks a key it cannot remove, and reports nothing", () => {
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        rememberBackend(openai);
        failOnSession("removeItem");

        expect(forgetBackend()).toBe(true);

        expect(rememberedConnection()).toBeNull();
        expect(reported(logged)).toEqual([]);
        expect(JSON.stringify(logged.entries)).not.toContain(KEY);
      });

      it("reports a key that survives a disconnect, without the key", () => {
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        rememberBackend(openai);
        failOnSession("removeItem", "setItem");

        expect(forgetBackend()).toBe(false);

        const failures = reported(logged);
        expect(failures).toHaveLength(1);
        expect(failures[0].ns).toBe("assistant:remembered-backend");
        expect(JSON.stringify(logged.entries)).not.toContain(KEY);
      });

      it("reports a key a failed write could not drop", () => {
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        rememberBackend(openai);
        failOnSession("removeItem", "setItem");

        rememberBackend(anthropic);

        expect(reported(logged)).toHaveLength(1);
        expect(JSON.stringify(logged.entries)).not.toContain(KEY);
      });

      it("reports nothing when storage is blocked outright", () => {
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        failOnSession("getItem", "setItem", "removeItem");
        rememberBackend(openai);

        // Nothing could be written, so there is no key to have survived
        expect(forgetBackend()).toBe(true);
        expect(reported(logged)).toEqual([]);
      });
    });
  });
}
