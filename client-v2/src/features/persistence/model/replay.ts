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
