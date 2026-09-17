import type { ProviderId } from "./types";

/**
 * Which backend to reconnect to on the next load.
 *
 * Only the default backend is ever remembered. Every other provider needs an
 * API key, and the key is deliberately in memory only — see
 * `docs/decisions.md` -> D3. Remembering one of those without its key would
 * only return the user to a form they still have to fill in, so the stored
 * value would buy nothing. The default backend needs no key at all, which is
 * what makes it safe to store: the only thing written down is that the user
 * picked it.
 *
 * Every access is guarded. `localStorage` throws rather than returning `null`
 * in a private window or with site data blocked, and the panel has to open
 * either way — forgetting a preference is not worth a broken assistant.
 */
const KEY = "assistant.backend";

const DEFAULT_ID: ProviderId = "default";

/** Record the user's choice, so the next load can act on it */
export const rememberBackend = (id: ProviderId) => {
  try {
    // Written down as a whole id rather than a flag, so switching to a
    // key-based backend overwrites it instead of leaving a stale `true`
    // behind, and so a later decision to remember more is not a migration
    localStorage.setItem(KEY, id);
  } catch {}
};

/** Drop the choice. Disconnecting is the user saying not to reconnect. */
export const forgetBackend = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {}
};

/** Whether this browser should reconnect to the default backend by itself */
export const isDefaultBackendRemembered = () => {
  try {
    return localStorage.getItem(KEY) === DEFAULT_ID;
  } catch {
    return false;
  }
};
