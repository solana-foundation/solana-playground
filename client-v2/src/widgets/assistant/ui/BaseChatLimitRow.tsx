import type { ChatLimitExceeded } from "@/features/persistence";
import { Callout, CalloutDescription, CalloutTitle } from "@/shared/ui/callout";

import { chatLimitText } from "../model/chat-limit";

export interface BaseChatLimitRowProps {
  limit: ChatLimitExceeded;
}

/**
 * The line above the composer while the account is at a conversation cap
 * (HOO-2882). Not a thread item: a notice in the thread is stored and pushed
 * with it, which is exactly what the account has no room for.
 */
export function BaseChatLimitRow({ limit }: BaseChatLimitRowProps) {
  return (
    // The composer's own inset (`AssistantComposer`), so the two rows line up
    <div className="shrink-0 px-3 pt-2">
      <Callout id="assistant-chat-limit" variant="warning" role="status">
        <CalloutTitle>Conversations are not syncing</CalloutTitle>
        <CalloutDescription>{chatLimitText(limit)}</CalloutDescription>
      </Callout>
    </div>
  );
}
