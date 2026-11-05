/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("tutorial-frame:storage");

/**
 * What the frame keeps on this device: the chat width someone dragged to,
 * and whether the first fold's hint has shown. Both are conveniences, so
 * storage that refuses is logged and the frame goes on with its defaults.
 */
export const FRAME_KEYS = {
  chatWidth: "tutorial.chatWidth",
  hintSeen: "tutorial.navHintSeen",
} as const;

const read = (key: string, storage?: Storage): string | null => {
  try {
    // Resolved in here: where site data is blocked, reaching
    // `window.localStorage` is itself what throws
    return (storage ?? localStorage).getItem(key);
  } catch (e) {
    log.warn("frame storage unreadable", { context: { key, e } });
    return null;
  }
};

const write = (key: string, value: string | null, storage?: Storage) => {
  try {
    const s = storage ?? localStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch (e) {
    log.warn("frame storage refused a write", { context: { key, e } });
  }
};

/** The width someone dragged the chat to, or null while it follows the window */
export const readChatWidth = (storage?: Storage): number | null => {
  const raw = read(FRAME_KEYS.chatWidth, storage);
  if (raw === null) return null;
  const width = Number(raw);
  // `Number("")` is 0, which is no width either
  if (Number.isFinite(width) && width > 0) return width;
  log.warn("chat width unreadable", { context: { raw } });
  return null;
};

/** Null hands the width back to the window */
export const writeChatWidth = (width: number | null, storage?: Storage) =>
  write(FRAME_KEYS.chatWidth, width === null ? null : String(width), storage);

export const readHintSeen = (storage?: Storage): boolean =>
  read(FRAME_KEYS.hintSeen, storage) === "1";

export const writeHintSeen = (storage?: Storage) =>
  write(FRAME_KEYS.hintSeen, "1", storage);

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("widgets/tutorial-frame/model/storage", () => {
    const memory = (): Storage => {
      const map = new Map<string, string>();
      return {
        get length() {
          return map.size;
        },
        clear: () => map.clear(),
        getItem: (k) => map.get(k) ?? null,
        key: (i) => Array.from(map.keys())[i] ?? null,
        removeItem: (k) => void map.delete(k),
        setItem: (k, v) => void map.set(k, v),
      };
    };

    it("keeps a dragged width and hands it back on null", () => {
      const s = memory();
      expect(readChatWidth(s)).toBeNull();
      writeChatWidth(452, s);
      expect(readChatWidth(s)).toBe(452);
      writeChatWidth(null, s);
      expect(readChatWidth(s)).toBeNull();
    });

    it("reads a width that is not a number as none", () => {
      const s = memory();
      s.setItem(FRAME_KEYS.chatWidth, "wide");
      expect(readChatWidth(s)).toBeNull();
      // `Number("")` is 0
      s.setItem(FRAME_KEYS.chatWidth, "");
      expect(readChatWidth(s)).toBeNull();
    });

    it("remembers the hint once seen", () => {
      const s = memory();
      expect(readHintSeen(s)).toBe(false);
      writeHintSeen(s);
      expect(readHintSeen(s)).toBe(true);
    });

    it("goes on with the defaults when storage throws", () => {
      const s = memory();
      vi.spyOn(s, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(s, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      expect(readChatWidth(s)).toBeNull();
      expect(readHintSeen(s)).toBe(false);
      expect(() => writeHintSeen(s)).not.toThrow();
    });
  });
}
