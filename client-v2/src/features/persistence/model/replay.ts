import type { ChatItem } from "../../../views/sidebar/assistant/store";

/** One turn of a rehydrated conversation, as every backend understands it */
export interface ReplayMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Rebuild enough history for the model to know what was said.
 *
 * Only what was said. Tool calls and approvals are dropped, because their
 * provider-native records were never stored -- the panel keeps a render model,
 * not a wire transcript -- and a half-reconstructed tool exchange is worse than
 * none: a model shown a call with no result will often repeat it.
 *
 * What it loses that way it gets back from `describeProject`, which re-sends
 * the live project on every turn. So a restored thread gives the model memory
 * of the conversation and a current view of the files, rather than memory of a
 * file state that has since moved on.
 *
 * This is why a restored thread is honest history rather than a resumed
 * session -- see `docs/persistent-conversations-spec.md`.
 */
export const toReplayMessages = (items: readonly ChatItem[]): ReplayMessage[] =>
  items.flatMap((item) =>
    (item.kind === "user" || item.kind === "assistant") && item.text.trim()
      ? [{ role: item.kind, content: item.text }]
      : []
  );

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const base = { id: "a", createdAt: "2026-01-01T00:00:00.000Z" };

  describe("toReplayMessages", () => {
    it("keeps user and assistant text in order", () => {
      const items: ChatItem[] = [
        { ...base, kind: "user", text: "hi" },
        { ...base, kind: "assistant", text: "hello" },
      ];

      expect(toReplayMessages(items)).toEqual([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ]);
    });

    it("drops tool, approval, error and notice items", () => {
      const items: ChatItem[] = [
        { ...base, kind: "tool", label: "read src/lib.rs" },
        {
          ...base,
          kind: "approval",
          status: "allowed",
          request: { type: "command", name: "build", effect: "x" },
        },
        { ...base, kind: "error", text: "boom" },
        { ...base, kind: "notice", text: "stopped" },
      ];

      expect(toReplayMessages(items)).toEqual([]);
    });

    it("drops empty text, which a stopped turn leaves behind", () => {
      const items: ChatItem[] = [
        { ...base, kind: "assistant", text: "  " },
        { ...base, kind: "user", text: "" },
      ];

      expect(toReplayMessages(items)).toEqual([]);
    });

    it("keeps the conversation readable around dropped items", () => {
      const items: ChatItem[] = [
        { ...base, kind: "user", text: "add a log" },
        { ...base, kind: "tool", label: "write src/lib.rs" },
        {
          ...base,
          kind: "approval",
          status: "allowed",
          request: {
            type: "patch",
            path: "src/lib.rs",
            before: "a",
            after: "b",
          },
        },
        { ...base, kind: "assistant", text: "Added it." },
      ];

      expect(toReplayMessages(items)).toEqual([
        { role: "user", content: "add a log" },
        { role: "assistant", content: "Added it." },
      ]);
    });

    it("is empty for an empty thread", () => {
      expect(toReplayMessages([])).toEqual([]);
    });
  });
}
