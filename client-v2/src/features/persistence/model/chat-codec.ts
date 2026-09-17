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
 * A `pending` approval becomes `denied`: the promise that blocked the agent
 * loop is gone once the session ends, so a restored pending card would spin
 * for ever with nothing able to resolve it.
 */
export const encodeItem = (item: ChatItem): StoredItem => {
  if (item.kind !== "approval") return item;

  return {
    ...item,
    status: item.status === "pending" ? "denied" : item.status,
    request: encodeRequest(item.request),
  };
};

export const encodeThread = (items: readonly ChatItem[]): StoredItem[] =>
  items.map(encodeItem);

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

/** Read one stored item, or `null` if it is not one */
export const decodeItem = (stored: unknown): ChatItem | null =>
  isStoredItem(stored) ? stored : null;

/**
 * Read a stored thread back.
 *
 * Tolerant by design: this JSON sits in the browser's own storage where a user
 * can edit it, and a corrupt entry must cost one item rather than the whole
 * conversation.
 */
export const decodeThread = (stored: unknown): ChatItem[] =>
  Array.isArray(stored) ? stored.filter(isStoredItem) : [];
