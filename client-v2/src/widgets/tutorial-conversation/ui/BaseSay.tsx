import { ArrowUpRight } from "lucide-react";

import type { Quote, Text } from "@/entities/tutorial";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Prose, READ } from "./Prose";

export interface BaseSayProps {
  text: Text;
  quote?: Quote;
  /** The quoted line as the file holds it now; null when it cannot be read */
  quoted?: string | null;
  /** The quote's step has passed: an error quote goes quiet */
  settled?: boolean;
  /** Open the quoted line in the editor */
  onShowQuote?: (quote: Quote) => void;
}

const baseName = (path: string) => path.split("/").pop() ?? path;

/**
 * The assistant's line, with no bubble: prose on the column's ground. With a
 * quote, the line in question follows in a box with "Show in <file>", lit as
 * the definition marks it, or red for an error until its step passes.
 */
const BaseSay = ({
  text,
  quote,
  quoted,
  settled = false,
  onShowQuote,
}: BaseSayProps) => {
  const error = quote?.tone === "error" && !settled;
  return (
    <div className="flex flex-col gap-3">
      <p className={READ}>
        <Prose text={text} />
      </p>
      {quote && (
        <figure className="overflow-hidden rounded-control border border-border bg-surface-well">
          <figcaption className="flex h-7 items-center gap-2 border-b border-border px-3 text-[0.75rem]">
            <span className="font-mono text-muted-foreground">
              {quote.file}
            </span>
            {onShowQuote && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onShowQuote(quote)}
                className="ml-auto h-6 gap-1 text-[0.75rem] text-muted-foreground"
              >
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
                Show in {baseName(quote.file)}
              </Button>
            )}
          </figcaption>
          <pre
            className={cn(
              "overflow-x-auto border-l-2 px-3 py-1.5 font-mono text-[0.75rem] leading-[1.6] text-foreground",
              error
                ? "border-error bg-error/10"
                : "border-primary bg-primary/10"
            )}
          >
            <span className="mr-3 text-subtle tabular-nums">{quote.line}</span>
            {quoted ?? ""}
          </pre>
        </figure>
      )}
    </div>
  );
};

export default BaseSay;
