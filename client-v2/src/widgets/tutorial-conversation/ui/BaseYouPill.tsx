import { cn } from "@/shared/lib/utils";

export interface BaseYouPillProps {
  text: string;
  /** A code pick reads as code */
  code: boolean;
}

/** The learner's turn: a click that spoke for them, echoed as a small pill */
const BaseYouPill = ({ text, code }: BaseYouPillProps) => (
  <p
    className={cn(
      "ml-auto w-fit max-w-[85%] rounded-panel bg-surface-raised px-3 py-2 text-foreground",
      code ? "font-mono text-[0.8125rem]" : "text-control"
    )}
  >
    {text}
  </p>
);

export default BaseYouPill;
