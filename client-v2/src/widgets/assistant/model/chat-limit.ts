import { useEffect, useState } from "react";

import {
  type ChatLimitExceeded,
  chatSyncLimit,
  onDidChangeChatSyncLimit,
} from "@/features/persistence";

/** The cap a refusal names, as a sentence with its figure */
const CAP: Record<ChatLimitExceeded["reason"], (limit: number) => string> = {
  "too-many-threads": (limit) =>
    `Your account syncs at most ${limit.toLocaleString(
      "en-US"
    )} conversations.`,
  "too-many-messages": (limit) =>
    `Your account syncs at most ${limit.toLocaleString("en-US")} messages.`,
  "conversations-too-large": (limit) =>
    `Your account syncs at most ${Math.round(
      limit / (1024 * 1024)
    )} MB of conversations.`,
};

/**
 * What the panel says while a push is refused for an account cap
 * (HOO-2882): the cap with its figure, that new messages stay here, and the
 * one way to make room, since a conversation is deleted only with its
 * project. The figure is the server's, from the refusal.
 */
export const chatLimitText = ({ reason, limit }: ChatLimitExceeded) =>
  `${CAP[reason](limit)} New messages stay in this browser. ` +
  "Delete a synced project you no longer need to remove its conversations " +
  "and make room.";

/** The cap the last conversation push was refused for, or `null` */
export const useChatLimit = () => {
  const [limit, setLimit] = useState(chatSyncLimit);
  useEffect(
    () => onDidChangeChatSyncLimit(() => setLimit(chatSyncLimit())).dispose,
    []
  );
  return limit;
};
