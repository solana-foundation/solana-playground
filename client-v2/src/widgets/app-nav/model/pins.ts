import { createLogger } from "@/shared/lib/logger";

const log = createLogger("app-nav:pins");

/**
 * Where the navigation keeps pinned workspace ids: on this device only
 * (syncing them across devices is HOO-2121). Ids, not names, so a rename
 * keeps the pin.
 */
export const PINS_KEY = "nav.pins";

const isIdList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * The pinned ids. Nothing stored is no pins; a value that is not a list of
 * ids, or storage that cannot be read, is no pins too, logged, so a bad
 * value never takes the navigation down.
 */
export const readPins = (storage?: Storage): string[] => {
  let raw: string | null;
  try {
    // Resolved in here: where site data is blocked, reaching
    // `window.localStorage` is itself what throws
    raw = (storage ?? localStorage).getItem(PINS_KEY);
  } catch (e) {
    log.warn("pins unreadable: storage unavailable", { context: { e } });
    return [];
  }
  if (raw === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    log.warn("pins unreadable: not JSON", { context: { e } });
    return [];
  }
  if (isIdList(value)) return value;

  log.warn("pins unreadable: not a list of ids");
  return [];
};

/** Throws when storage refuses the write; a caller acting for the user tells them */
export const writePins = (ids: readonly string[], storage?: Storage) =>
  (storage ?? localStorage).setItem(PINS_KEY, JSON.stringify(ids));

export const togglePin = (pins: readonly string[], id: string) =>
  pins.includes(id) ? pins.filter((pin) => pin !== id) : [...pins, id];

/** Drops pins no workspace has any more, keeping the order of the rest */
export const prunePins = (
  pins: readonly string[],
  liveIds: readonly string[]
) => pins.filter((pin) => liveIds.includes(pin));
