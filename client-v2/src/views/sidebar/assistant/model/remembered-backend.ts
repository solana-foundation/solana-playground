import { createLogger } from "@/shared/lib/logger";
import type { Connection } from "../store";
import { PROVIDERS, type ProviderId } from "./types";

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
const BACKEND_KEY = "assistant.backend";
const CONNECTION_KEY = "assistant.connection";

const DEFAULT_ID: ProviderId = "default";

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
    localStorage.setItem(BACKEND_KEY, connection.id)
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
  attempt("forget the backend", () => localStorage.removeItem(BACKEND_KEY));
  return dropKept("forget the key");
};

/** Whether this browser should reconnect to the default backend by itself */
export const isDefaultBackendRemembered = () =>
  guarded(
    "read the remembered backend",
    () => localStorage.getItem(BACKEND_KEY) === DEFAULT_ID,
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
