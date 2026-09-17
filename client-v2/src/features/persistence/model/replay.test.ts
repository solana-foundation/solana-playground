import { toReplayMessages } from "./replay";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

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
        request: { type: "patch", path: "src/lib.rs", before: "a", after: "b" },
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
