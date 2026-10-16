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
