import { cn } from "@/shared/lib/utils";

import { Prose } from "./Prose";

export interface BaseYouPillProps {
  text: string;
  /** A code pick reads as code */
  code: boolean;
}

/**
 * The learner's turn: a click that spoke for them, echoed as a small pill.
 * Code stays one colour, in the listing's 14/24; words read at the text's
 * 16/24, with their code in chips as the option showed it
 */
const BaseYouPill = ({ text, code }: BaseYouPillProps) => (
  <p
    className={cn(
      "ml-auto w-fit max-w-[85%] rounded-panel bg-surface-raised px-3 py-2 text-foreground",
      code
        ? "font-mono text-[14px] leading-6 break-words"
        : "text-[1rem] leading-[1.5rem]"
    )}
  >
    {code ? text : <Prose text={text} />}
  </p>
);

export default BaseYouPill;
