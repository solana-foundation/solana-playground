import type { ReactNode } from "react";

import {
  Composer,
  ComposerBanner,
  ComposerSend,
  ComposerToolbar,
} from "@/shared/ui/composer";
import { LogoPlay } from "@/shared/ui/logo";

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
      className="min-h-16 w-full px-[1.125rem] pt-[1.125rem] text-left text-[0.9375rem] text-subtle outline-none max-md:min-h-12 max-md:px-4 max-md:pt-3 max-md:text-body max-md:font-read"
    >
      Ask anything…
    </button>
    <ComposerToolbar>
      {/* At full strength, as the prototype's: there is nothing to type
          here, so it opens the assistant like the rest of the box */}
      <ComposerSend type="button" disabled={false} onClick={onAsk}>
        <LogoPlay />
      </ComposerSend>
    </ComposerToolbar>
  </Composer>
);

export default HomeComposer;
