import type {
  ApprovalRequest,
  ChatItem,
} from "../../../views/sidebar/assistant/store";

/**
 * Unchanged lines kept either side of a change.
 *
 * Matches `CONTEXT_LINES` in the assistant's `diff.ts`. Deliberately not
 * imported from there: this decides what is *stored*, and a rendering tweak
 * should not silently change the shape of data already on disk.
 */
const CONTEXT_LINES = 3;

/** One item as it is written to IndexedDB and to Postgres */
export type StoredItem = ChatItem;

/**
 * Reduce a patch to the region the approval card actually shows.
 *
 * The renderer already trims the common prefix and suffix to `CONTEXT_LINES`,
 * so storing the trimmed pair renders identically while costing a fraction of
 * the bytes -- a full `before`/`after` pair is two whole copies of the file,
 * per edit, and a long session holds dozens.
 *
 * @param before current content, or `null` for a new file
 * @param after proposed content
 */
export const trimPatch = (before: string | null, after: string) => {
  if (before === null || before === after) return { before, after };

  const oldLines = before.split("\n");
  const newLines = after.split("\n");

  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  let fromEnd = 0;
  while (
    fromEnd < oldLines.length - start &&
    fromEnd < newLines.length - start &&
    oldLines[oldLines.length - 1 - fromEnd] ===
      newLines[newLines.length - 1 - fromEnd]
  ) {
    fromEnd++;
  }

  const from = Math.max(0, start - CONTEXT_LINES);
  const oldTo = Math.min(
    oldLines.length,
    oldLines.length - fromEnd + CONTEXT_LINES
  );
  const newTo = Math.min(
    newLines.length,
    newLines.length - fromEnd + CONTEXT_LINES
  );

  return {
    before: oldLines.slice(from, oldTo).join("\n"),
    after: newLines.slice(from, newTo).join("\n"),
  };
};

const encodeRequest = (request: ApprovalRequest): ApprovalRequest => {
  if (request.type !== "patch") return request;

  const { before, after } = trimPatch(request.before, request.after);
  return { ...request, before, after };
};

/**
 * Prepare one item for storage.
 *
 * A `pending` approval becomes `unanswered`: the promise that blocked the
 * agent loop is gone once the session ends, so a restored pending card would
 * spin for ever with nothing able to resolve it. It is not `denied`, which
 * would report a refusal the user never made.
 */
export const encodeItem = (item: ChatItem): StoredItem => {
  if (item.kind !== "approval") return item;

  return {
    ...item,
    status: item.status === "pending" ? "unanswered" : item.status,
    request: encodeRequest(item.request),
  };
};

export const encodeThread = (items: readonly ChatItem[]): StoredItem[] =>
  items.map(encodeItem);

/** Oldest first, ties broken by id so two devices agree on the order */
const byTime = (a: ChatItem, b: ChatItem) =>
  a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);

/**
 * When an item last changed, as a number a comparison can use: `updatedAt`
 * when it has one, else `createdAt`. `NaN` for a version that does not parse.
 */
export const versionOf = (item: ChatItem) =>
  Date.parse(item.updatedAt ?? item.createdAt);

/**
 * Union two copies of a thread by id, keeping the newer copy of each item.
 *
 * Items change after they are created -- a reply streams in, an approval is
 * answered -- so two copies of one id can differ, and the one with the later
 * version is the more complete. Local-wins used to be the rule, which let a
 * device that pulled a reply mid-stream keep the fragment for ever over the
 * finished copy the server had since been given. A tie goes to local, so an
 * item nobody has changed is left exactly as this device has it -- the very
 * same object, which is what lets the store fold a pull into a turn that is
 * still streaming into one of them.
 *
 * Versions from two devices are compared without trusting their clocks to
 * agree, and safely: a message is only ever changed by the tab running its
 * turn -- the reply streams there, and only there can an approval be answered
 * or given an outcome, because the promise it resolves lives in that tab's
 * memory and a restored card is never pending. So both copies of an id carry
 * stamps from one clock, and the comparison never crosses devices.
 *
 * Here rather than in `chat-sync`, because the store uses it too and must not
 * import the sync client to get it.
 *
 * @param theirs the server's copy, or whichever side loses ties
 * @param local this device's copy, which wins them
 * @returns the union, oldest first
 */
export const mergeThreads = (
  theirs: readonly ChatItem[],
  local: readonly ChatItem[]
) => {
  const byId = new Map<string, ChatItem>();
  for (const item of theirs) byId.set(item.id, item);
  for (const item of local) {
    const other = byId.get(item.id);
    // `!(a > b)` rather than `a <= b`, so a version that does not parse
    // keeps the local copy instead of dropping it
    if (!other || !(versionOf(other) > versionOf(item))) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort(byTime);
};

const KINDS = new Set<ChatItem["kind"]>([
  "user",
  "assistant",
  "tool",
  "approval",
  "error",
  "notice",
]);

const isStoredItem = (value: unknown): value is StoredItem => {
  if (!value || typeof value !== "object") return false;

  const item = value as Partial<ChatItem>;
  return (
    typeof item.id === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.kind === "string" &&
    KINDS.has(item.kind as ChatItem["kind"])
  );
};

/**
 * Read one stored item, or `null` if it is not one.
 *
 * An `updatedAt` that does not parse is dropped rather than costing the item:
 * the item falls back to `createdAt` as its version. Kept, it would be
 * uploaded with every push of the thread, and the server refuses a whole
 * thread over one item it cannot cast.
 */
export const decodeItem = (stored: unknown): ChatItem | null => {
  if (!isStoredItem(stored)) return null;
  if (stored.updatedAt === undefined) return stored;
  if (
    typeof stored.updatedAt === "string" &&
    !Number.isNaN(Date.parse(stored.updatedAt))
  ) {
    return stored;
  }

  const item = { ...stored };
  delete item.updatedAt;
  return item;
};

/**
 * Read a stored thread back.
 *
 * Tolerant by design: this JSON sits in the browser's own storage where a user
 * can edit it, and a corrupt entry must cost one item rather than the whole
 * conversation.
 */
export const decodeThread = (stored: unknown): ChatItem[] =>
  Array.isArray(stored)
    ? stored.map(decodeItem).filter((item): item is ChatItem => item !== null)
    : [];

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/persistence/model/chat-codec", () => {
    const base = {
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    const bigFile = Array.from({ length: 200 }, (_, i) => `line ${i}`).join(
      "\n"
    );

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
        expect(trimPatch(null, "a\nb")).toEqual({
          before: null,
          after: "a\nb",
        });
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

      it("keeps an undone patch undone and a reply's state", () => {
        const undone: ChatItem = {
          id: base.id,
          createdAt: base.createdAt,
          kind: "approval",
          status: "allowed",
          undone: true,
          request: {
            type: "patch",
            path: "src/lib.rs",
            before: "a",
            after: "b",
          },
        };
        const cut: ChatItem = {
          id: base.id,
          createdAt: base.createdAt,
          kind: "assistant",
          text: "The program",
          state: "cut-off",
        };

        expect(encodeItem(undone)).toMatchObject({ undone: true });
        expect(encodeItem(cut)).toMatchObject({ state: "cut-off" });
        // And back, through JSON as storage and the server hold it
        const stored = JSON.parse(JSON.stringify([undone, cut]));
        expect(decodeThread(stored)).toEqual([undone, cut]);
      });

      it("stores a pending approval as unanswered, since it can never resume", () => {
        const item: ChatItem = {
          ...base,
          kind: "approval",
          status: "pending",
          request: {
            type: "command",
            name: "build",
            effect: "Builds the program",
          },
        };

        // Not `denied`: the user never said no, the session ended under the card
        expect(encodeItem(item)).toMatchObject({ status: "unanswered" });
      });

      it("leaves a settled approval's status alone", () => {
        for (const status of ["allowed", "denied", "unanswered"] as const) {
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

      it("keeps an item's version, which the server and a pull decide on", () => {
        const updatedAt = "2026-01-01T00:00:05.000Z";
        const reply: ChatItem = {
          ...base,
          kind: "assistant",
          text: "done",
          updatedAt,
        };
        const approval: ChatItem = {
          ...base,
          kind: "approval",
          status: "allowed",
          request: { type: "command", name: "build", effect: "x" },
          updatedAt,
        };

        expect(encodeItem(reply)).toMatchObject({ updatedAt });
        expect(encodeItem(approval)).toMatchObject({ updatedAt });
        expect(
          encodeItem({ ...approval, status: "pending" } as ChatItem)
        ).toMatchObject({ status: "unanswered", updatedAt });
        expect(decodeItem(encodeItem(reply))).toMatchObject({ updatedAt });
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

      it("drops an updatedAt that does not parse, keeping the item", () => {
        // The server refuses a whole thread over one item it cannot cast, so a
        // bad stamp kept would fail every push of the thread for ever
        const unstamped = {
          id: base.id,
          createdAt: base.createdAt,
          kind: "user",
          text: "hi",
        };
        /** `unstamped`, carrying `updatedAt` as stored */
        const stampedWith = (updatedAt: unknown) => ({
          id: base.id,
          createdAt: base.createdAt,
          kind: "user",
          text: "hi",
          updatedAt,
        });

        for (const updatedAt of ["yesterday", 42, null]) {
          expect(decodeItem(stampedWith(updatedAt))).toEqual(unstamped);
        }
        expect(decodeThread([stampedWith("nope")])).toEqual([unstamped]);
      });
    });
  });
}
