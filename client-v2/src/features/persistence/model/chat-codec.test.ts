import {
  decodeItem,
  decodeThread,
  encodeItem,
  encodeThread,
  trimPatch,
} from "./chat-codec";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const bigFile = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");

describe("trimPatch", () => {
  it("keeps only the changed region plus context", () => {
    const after = bigFile.replace("line 100", "line one hundred");

    const trimmed = trimPatch(bigFile, after);

    expect(trimmed.before!.split("\n").length).toBeLessThan(10);
    expect(trimmed.before).toContain("line 100");
    expect(trimmed.after).toContain("line one hundred");
  });

  it("keeps enough context either side to read the change", () => {
    const after = bigFile.replace("line 100", "changed");

    const { before } = trimPatch(bigFile, after);

    expect(before).toContain("line 97");
    expect(before).toContain("line 103");
  });

  it("passes a new file through, since there is nothing to trim against", () => {
    expect(trimPatch(null, "a\nb")).toEqual({ before: null, after: "a\nb" });
  });

  it("is a no-op when nothing changed", () => {
    expect(trimPatch("same", "same")).toEqual({
      before: "same",
      after: "same",
    });
  });

  it("handles a change at the very start", () => {
    const after = bigFile.replace("line 0", "first");
    const { after: trimmedAfter } = trimPatch(bigFile, after);

    expect(trimmedAfter).toContain("first");
    expect(trimmedAfter!.split("\n").length).toBeLessThan(10);
  });

  it("handles a change at the very end", () => {
    const after = bigFile.replace("line 199", "last");
    const { after: trimmedAfter } = trimPatch(bigFile, after);

    expect(trimmedAfter).toContain("last");
    expect(trimmedAfter!.split("\n").length).toBeLessThan(10);
  });
});

describe("encodeItem", () => {
  it("shrinks a patch approval to its changed region", () => {
    const item: ChatItem = {
      ...base,
      kind: "approval",
      status: "allowed",
      request: {
        type: "patch",
        path: "src/lib.rs",
        before: bigFile,
        after: bigFile.replace("line 100", "changed"),
      },
    };

    // Two whole copies of the file would be the naive encoding
    expect(JSON.stringify(encodeItem(item)).length).toBeLessThan(
      bigFile.length / 4
    );
  });

  it("stores a pending approval as denied, since it can never resume", () => {
    const item: ChatItem = {
      ...base,
      kind: "approval",
      status: "pending",
      request: { type: "command", name: "build", effect: "Builds the program" },
    };

    expect(encodeItem(item)).toMatchObject({ status: "denied" });
  });

  it("leaves a settled approval's status alone", () => {
    for (const status of ["allowed", "denied"] as const) {
      const item: ChatItem = {
        ...base,
        kind: "approval",
        status,
        request: { type: "command", name: "build", effect: "x" },
      };
      expect(encodeItem(item)).toMatchObject({ status });
    }
  });

  it("stores a command approval whole, being small already", () => {
    const request = {
      type: "command" as const,
      name: "deploy" as const,
      effect: "Spends SOL",
    };
    const item: ChatItem = {
      ...base,
      kind: "approval",
      status: "allowed",
      request,
    };

    expect(encodeItem(item)).toMatchObject({ request });
  });

  it("leaves non-approval items untouched", () => {
    const item: ChatItem = { ...base, kind: "user", text: "hi" };
    expect(encodeItem(item)).toEqual(item);
  });
});

describe("decodeThread", () => {
  it("round-trips text items", () => {
    const items: ChatItem[] = [
      { ...base, kind: "user", text: "hi" },
      {
        ...base,
        id: "22222222-2222-4222-8222-222222222222",
        kind: "assistant",
        text: "hello",
      },
    ];

    expect(decodeThread(encodeThread(items))).toEqual(items);
  });

  it("round-trips every kind", () => {
    const items: ChatItem[] = [
      { ...base, kind: "user", text: "u" },
      { ...base, kind: "assistant", text: "a" },
      { ...base, kind: "tool", label: "read src/lib.rs" },
      { ...base, kind: "error", text: "boom" },
      { ...base, kind: "notice", text: "stopped" },
      {
        ...base,
        kind: "approval",
        status: "allowed",
        request: { type: "command", name: "build", effect: "x" },
      },
    ];

    expect(decodeThread(encodeThread(items))).toHaveLength(items.length);
  });

  it("drops hand-edited junk rather than throwing", () => {
    expect(decodeThread([{ nonsense: true }, null, 7])).toEqual([]);
    expect(decodeThread("not an array")).toEqual([]);
    expect(decodeThread(undefined)).toEqual([]);
  });

  it("keeps the good items in a partly corrupt thread", () => {
    const good = { ...base, kind: "user" as const, text: "hi" };

    expect(decodeThread([good, null, { kind: "user" }])).toEqual([good]);
  });

  it("rejects an unknown kind, which would render as nothing", () => {
    expect(decodeItem({ ...base, kind: "wat", text: "x" })).toBeNull();
  });

  it("requires an id and a timestamp, which ordering depends on", () => {
    expect(
      decodeItem({ kind: "user", text: "x", createdAt: base.createdAt })
    ).toBeNull();
    expect(decodeItem({ kind: "user", text: "x", id: base.id })).toBeNull();
  });
});
