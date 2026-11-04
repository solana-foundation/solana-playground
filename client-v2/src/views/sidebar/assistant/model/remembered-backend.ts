import type { ModelProvider } from "@/shared/lib/ai";
import { createLogger } from "@/shared/lib/logger";

import type { Connection } from "../store";
import type { BackendParams } from "./backend-params";
import { backendParamsFrom, paramsOf } from "./backend-params";
import { REMEMBERED_BACKEND_KEY } from "./remembered-backend-key";

export { REMEMBERED_BACKEND_KEY } from "./remembered-backend-key";

/**
 * Which backend to offer on the next load.
 *
 * The backend last chosen is remembered by its parameters (provider, model,
 * base URL, effort) in `localStorage`, across tabs and restarts: nothing
 * secret is written. It reconnects the keyless default, and presets Connect a
 * model for a key-based one (HOO-1719).
 *
 * The user's own key is held in memory only, by `PgAssistant`, and never
 * written to browser storage: a reload, a new tab and a restored tab all ask
 * for it again (HOO-2423, the 29 Oct security review). Builds before that
 * kept the whole connection, key included, in `sessionStorage` under
 * `CONNECTION_KEY`; `dropKeptKey` removes what they left. See the change
 * `openspec/changes/archive/2026-11-03-assistant-key-in-memory/design.md`.
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

/** Whether a key that survived `dropKept` was reported in this tab already */
let survivorReported = false;

/**
 * Remove the connection an older build kept for this tab, the one way every
 * path that must lose the key does it. If the removal throws, the entry is
 * blanked instead, which leaves no key to read.
 *
 * Reported only when the key verifiably survived both, which is a privacy
 * failure the team must hear about, and once per tab. Storage that refuses everything (site
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

  // Once per tab: every mount of the panel and the Settings row tries again,
  // and a tab whose storage refuses writes would report on each
  if (!survivorReported) {
    survivorReported = true;
    log.error(new Error("could not forget the key kept for this tab"), {
      report: true,
    });
  }
  return false;
};

/**
 * Record the user's choice, so a later load can offer it again: its
 * parameters in every tab of this browser, never its key. A connection an
 * older build kept for this tab is dropped on the way, since it may hold an
 * earlier backend's key.
 */
export const rememberBackend = (connection: Connection) => {
  // The whole choice, so the newest pick always overwrites the last one.
  // `paramsOf` leaves the key out by construction
  attempt("remember the backend", () =>
    localStorage.setItem(
      REMEMBERED_BACKEND_KEY,
      JSON.stringify(paramsOf(connection))
    )
  );
  dropKept("forget the kept key");
};

/**
 * Drop the remembered choice and any connection an older build kept for this
 * tab. Disconnecting is the user saying not to reconnect. The key in memory
 * is dropped by `PgAssistant.disconnect`, which calls this.
 *
 * @returns whether no key is left in this tab's storage, so the caller can
 * tell the user when one is
 */
export const forgetBackend = () => {
  attempt("forget the backend", () =>
    localStorage.removeItem(REMEMBERED_BACKEND_KEY)
  );
  return dropKept("forget the key");
};

/**
 * A stored choice, read as `backendParamsFrom` reads any. Before HOO-1719
 * the choice was the bare provider id, which is not JSON; it reads as that
 * provider with nothing else.
 */
const choiceFrom = (raw: string): BackendParams | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON: the bare id written before the choice carried its parameters
    parsed = { provider: raw };
  }
  return backendParamsFrom(parsed);
};

/**
 * The backend this browser last chose, without its key: what a send with
 * nothing connected offers when the thread names no backend of its own
 */
export const rememberedChoice = (): BackendParams | undefined => {
  const raw = guarded(
    "read the remembered backend",
    () => localStorage.getItem(REMEMBERED_BACKEND_KEY) ?? undefined,
    undefined
  );
  if (raw === undefined) return undefined;
  const choice = choiceFrom(raw);
  // Logged without the value, like a dropped connection: without the choice a
  // send can only offer the default, and the log is where that shows
  if (!choice) log.warn("ignored a remembered backend this build cannot use");
  return choice;
};

/** Whether this browser should reconnect to the default backend by itself */
export const isDefaultBackendRemembered = () =>
  rememberedChoice()?.provider === DEFAULT_ID;

/**
 * Remove the key-based connection an older build kept for this tab. Run at
 * startup (`effects/kept-key`), whatever panel is open, and on every mount
 * that may come before it (the panel, the Settings row), so a tab reloaded
 * across the deploy does not keep the key in storage; it reads one entry when
 * nothing is kept.
 *
 * @returns whether the key is gone from this tab's storage
 */
export const dropKeptKey = () => {
  const left = guarded(
    "read the connection kept for this tab",
    () => sessionStorage.getItem(CONNECTION_KEY),
    null
  );
  if (left === null) return true;
  return dropKept("drop the kept key");
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

    /** What a build before HOO-2423 kept for the tab, key included */
    const keepAsOlderBuild = () =>
      sessionStorage.setItem(
        CONNECTION_KEY,
        JSON.stringify({ id: "openai", apiKey: KEY, endpoint: openai.endpoint })
      );

    /** Every value in both stores, to look for the key in */
    const everything = () =>
      JSON.stringify([
        storedValues(localStorage),
        storedValues(sessionStorage),
      ]);

    describe("remembered backend", () => {
      beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      afterEach(() => {
        vi.restoreAllMocks();
        resetLogger();
        survivorReported = false;
      });

      it("remembers nothing until a backend has been chosen", () => {
        expect(isDefaultBackendRemembered()).toBe(false);
        expect(rememberedChoice()).toBeUndefined();
      });

      it("remembers the default backend in localStorage only", () => {
        rememberBackend(defaultBackend);
        expect(isDefaultBackendRemembered()).toBe(true);
        expect(sessionStorage.length).toBe(0);
      });

      it("remembers the chosen backend's parameters without the key", () => {
        rememberBackend(openai);
        expect(rememberedChoice()).toEqual({
          provider: "openai",
          model: "gpt-x",
          baseUrl: "https://api.example.test/v1",
        });
        rememberBackend(anthropic);
        expect(rememberedChoice()).toEqual({
          provider: "anthropic",
          model: "claude-opus-5",
          effort: "high",
        });
        expect(isDefaultBackendRemembered()).toBe(false);
      });

      it("never writes the key to any storage", () => {
        rememberBackend(openai);
        rememberBackend(anthropic);
        expect(everything()).not.toContain(KEY);
        expect(sessionStorage.length).toBe(0);
      });

      it("reads a choice written as a bare provider id", () => {
        localStorage.setItem(REMEMBERED_BACKEND_KEY, "openai");
        expect(rememberedChoice()).toEqual({ provider: "openai" });
        localStorage.setItem(REMEMBERED_BACKEND_KEY, "default");
        expect(isDefaultBackendRemembered()).toBe(true);
      });

      it.each([
        ["an unknown provider", JSON.stringify({ provider: "nope" })],
        ["an unknown bare id", "nope"],
        ["no provider", JSON.stringify({ model: "m" })],
        ["JSON null", "null"],
      ])("reads %s as no choice", (_, raw) => {
        localStorage.setItem(REMEMBERED_BACKEND_KEY, raw);
        expect(rememberedChoice()).toBeUndefined();
        expect(isDefaultBackendRemembered()).toBe(false);
      });

      it("leaves out an effort the provider does not offer", () => {
        localStorage.setItem(
          REMEMBERED_BACKEND_KEY,
          JSON.stringify({ provider: "anthropic", model: "m", effort: "turbo" })
        );
        expect(rememberedChoice()).toEqual({
          provider: "anthropic",
          model: "m",
        });
      });

      it("drops a connection an older build kept for this tab", () => {
        keepAsOlderBuild();
        expect(dropKeptKey()).toBe(true);
        expect(sessionStorage.getItem(CONNECTION_KEY)).toBeNull();
      });

      it("drops a kept connection whichever backend is chosen next", () => {
        keepAsOlderBuild();
        rememberBackend(anthropic);
        expect(sessionStorage.length).toBe(0);
        keepAsOlderBuild();
        rememberBackend(defaultBackend);
        expect(sessionStorage.length).toBe(0);
      });

      it("forgets the choice and a kept key on request", () => {
        rememberBackend(openai);
        keepAsOlderBuild();
        expect(forgetBackend()).toBe(true);
        expect(isDefaultBackendRemembered()).toBe(false);
        expect(rememberedChoice()).toBeUndefined();
        expect(sessionStorage.length).toBe(0);
      });

      it("answers no when storage refuses to say", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
          throw new Error("SecurityError");
        });
        expect(isDefaultBackendRemembered()).toBe(false);
        expect(dropKeptKey()).toBe(true);
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

      it("blanks a kept key it cannot remove, and reports nothing", () => {
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        keepAsOlderBuild();
        failOnSession("removeItem");

        expect(dropKeptKey()).toBe(true);

        expect(sessionStorage.getItem(CONNECTION_KEY)).toBe("");
        expect(reported(logged)).toEqual([]);
        expect(JSON.stringify(logged.entries)).not.toContain(KEY);
      });

      it("reports a kept key that survives, without the key", () => {
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        keepAsOlderBuild();
        failOnSession("removeItem", "setItem");

        expect(forgetBackend()).toBe(false);

        const failures = reported(logged);
        expect(failures).toHaveLength(1);
        expect(failures[0].ns).toBe("assistant:remembered-backend");
        expect(JSON.stringify(logged.entries)).not.toContain(KEY);
      });

      it("reports a key that survives only once per tab", () => {
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        keepAsOlderBuild();
        failOnSession("removeItem", "setItem");

        expect(dropKeptKey()).toBe(false);
        expect(dropKeptKey()).toBe(false);
        expect(forgetBackend()).toBe(false);

        expect(reported(logged)).toHaveLength(1);
      });

      it("reports nothing when storage is blocked outright", () => {
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        failOnSession("getItem", "setItem", "removeItem");
        rememberBackend(openai);

        // Nothing could be written, so there is no key to have survived
        expect(forgetBackend()).toBe(true);
        expect(dropKeptKey()).toBe(true);
        expect(reported(logged)).toEqual([]);
      });
    });
  });
}
