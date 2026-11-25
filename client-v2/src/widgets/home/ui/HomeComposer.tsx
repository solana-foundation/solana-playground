import type { ReactNode } from "react";
import { useState } from "react";

import {
  Composer,
  ComposerBanner,
  ComposerInput,
  ComposerSend,
  ComposerToolbar,
} from "@/shared/ui/composer";
import { LogoPlay } from "@/shared/ui/logo";

interface HomeComposerProps {
  /** The question typed, handed to the assistant panel */
  onAsk: (text: string) => void;
  banner?: ReactNode;
  /**
   * What a send will need while no model can answer this user, such as a
   * sign-in, said beside Send before anything is typed
   */
  sendHint?: string;
}

/**
 * The ask box on Home: a real input, as it looks. Send hands the question to
 * the assistant panel, which asks for a sign-in or a key there if it needs
 * one and keeps the question in its composer meanwhile. It was a button drawn
 * as an input, which read as broken to a user who could not type in it
 * (user feedback, 25 Nov).
 */
const HomeComposer = ({ onAsk, banner, sendHint }: HomeComposerProps) => {
  const [text, setText] = useState("");
  return (
    <Composer
      onSubmit={() => {
        onAsk(text.trim());
        setText("");
      }}
    >
      {banner ? <ComposerBanner>{banner}</ComposerBanner> : null}
      <ComposerInput
        aria-label="Ask the assistant"
        placeholder="Ask anything…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-16 max-md:min-h-12 max-md:px-4 max-md:pt-3"
      />
      <ComposerToolbar>
        {sendHint !== undefined && (
          <span className="pl-2.5 text-xs font-read text-muted-foreground max-md:text-control">
            {sendHint}
          </span>
        )}
        <ComposerSend>
          <LogoPlay />
        </ComposerSend>
      </ComposerToolbar>
    </Composer>
  );
};

export default HomeComposer;
