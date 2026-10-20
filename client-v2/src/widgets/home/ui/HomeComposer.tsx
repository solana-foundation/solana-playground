import type { ReactNode } from "react";
import { ArrowUp } from "lucide-react";

import {
  Composer,
  ComposerBanner,
  ComposerSend,
  ComposerToolbar,
} from "@/shared/ui/composer";

interface HomeComposerProps {
  onAsk: () => void;
  banner?: ReactNode;
}

/**
 * The composer that opens the assistant. It has no textarea: what it would
 * send without a project is a later stage's question, so the whole input is
 * one button that hands over to the assistant panel.
 */
const HomeComposer = ({ onAsk, banner }: HomeComposerProps) => (
  <Composer>
    {banner ? <ComposerBanner>{banner}</ComposerBanner> : null}
    <button
      type="button"
      aria-label="Ask the assistant"
      onClick={onAsk}
      className="min-h-12 w-full px-4 pt-3.5 text-left text-muted-foreground outline-none"
    >
      Ask anything…
    </button>
    <ComposerToolbar>
      <ComposerSend disabled>
        <ArrowUp />
      </ComposerSend>
    </ComposerToolbar>
  </Composer>
);

export default HomeComposer;
