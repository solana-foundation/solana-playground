/**
 * The chat column's range in px. The workspace beside it never drops under
 * `workspaceMin`, and the rail takes `rail` on its left.
 */
export const CHAT_WIDTH = {
  min: 340,
  max: 560,
  workspaceMin: 560,
  rail: 52,
  /** What one arrow key moves the edge by, about a word of the chat */
  step: 16,
} as const;

/**
 * The width the chat takes until someone drags its edge: about the share chat
 * columns take beside an open editor, 360 at 1152, 400 at 1280, 421 at 1440,
 * never under 360 or over 480. Under 1280 it gives way faster, so the editor
 * keeps its room (the prototype's `byWindow`, which wins over the delta's
 * single slope; the prototype's comment rounds 421.44 down to 420).
 */
export const chatDefaultWidth = (windowWidth: number): number => {
  const chat =
    windowWidth < 1280
      ? 400 - (1280 - windowWidth) * 0.3125
      : 400 + (windowWidth - 1280) * 0.134;
  return Math.round(Math.min(480, Math.max(360, chat)));
};

/**
 * A width someone picked, held to the range and to what the window leaves
 * the workspace.
 */
export const clampChatWidth = (width: number, windowWidth: number): number => {
  const roomLeft = windowWidth - CHAT_WIDTH.rail - CHAT_WIDTH.workspaceMin;
  const max = Math.max(CHAT_WIDTH.min, Math.min(CHAT_WIDTH.max, roomLeft));
  return Math.min(max, Math.max(CHAT_WIDTH.min, Math.round(width)));
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-frame/model/chat-width", () => {
    it.each([
      [1152, 360],
      [1280, 400],
      [1440, 421],
      [1728, 460],
      [2560, 480],
      [1000, 360],
    ])("takes %i px of window as %i px of chat", (w, chat) => {
      expect(chatDefaultWidth(w)).toBe(chat);
    });

    it("holds a pick to 340..560", () => {
      expect(clampChatWidth(200, 1920)).toBe(340);
      expect(clampChatWidth(700, 1920)).toBe(560);
      expect(clampChatWidth(450.6, 1920)).toBe(451);
    });

    it("leaves the workspace 560 px beside the rail", () => {
      // 1280 - 52 - 560 = 668, over the max: the max holds
      expect(clampChatWidth(560, 1280)).toBe(560);
      // 1152 - 52 - 560 = 540
      expect(clampChatWidth(560, 1152)).toBe(540);
    });

    it("never goes under its minimum, even when the window is too narrow", () => {
      expect(clampChatWidth(500, 900)).toBe(340);
    });
  });
}
