import type { ChatItem } from "../store";
import { backendParamsFrom } from "./backend-params";
import type { BackendParams } from "./backend-params";

/**
 * The backend the open thread was last answered by: the `origin` of its last
 * reply that names one this build still has, or `undefined`. A send with
 * nothing connected goes back to it rather than to whatever happens to be
 * connectable, so a thread held with the user's own model is never continued
 * on the default behind their back (HOO-1719).
 */
export const threadBackend = (
  items: readonly ChatItem[]
): BackendParams | undefined => {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "assistant" || !item.origin) continue;
    const origin = backendParamsFrom(item.origin);
    if (origin) return origin;
  }
  return undefined;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/sidebar/assistant/model/thread-backend", () => {
    const reply = (origin?: BackendParams): ChatItem => ({
      kind: "assistant",
      id: `a-${origin?.provider ?? "none"}`,
      createdAt: "2026-10-28T00:00:00.000Z",
      text: "hi",
      origin,
    });
    const user: ChatItem = {
      kind: "user",
      id: "u",
      createdAt: "2026-10-28T00:00:00.000Z",
      text: "q",
    };

    it("answers the last reply's origin", () => {
      const openai: BackendParams = { provider: "openai", model: "gpt-x" };
      expect(
        threadBackend([
          reply({ provider: "default" }),
          user,
          reply(openai),
          user,
        ])
      ).toEqual(openai);
    });

    it("skips replies with no origin", () => {
      const anthropic: BackendParams = { provider: "anthropic" };
      expect(threadBackend([reply(anthropic), reply()])).toEqual(anthropic);
    });

    it("reads a provider this build no longer has as absent", () => {
      expect(
        threadBackend([
          reply({ provider: "gone" as BackendParams["provider"] }),
        ])
      ).toBeUndefined();
    });

    it("answers nothing for a thread with no reply", () => {
      expect(threadBackend([user])).toBeUndefined();
    });
  });
}
