import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/* Copies one value: a program id, a signature, a command. Its tooltip turns
   from Copy to Copied, in green, and back. A clipboard that refuses (or a
   browser with none) goes to onError, rethrown without one so it surfaces
   as an unhandled rejection, and never shows Copied. */
function CopyButton({
  value,
  label = "Copy",
  onError,
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof Button>,
  "value" | "onClick" | "onError" | "aria-label"
> & {
  value: string;
  /** its accessible name until a copy succeeds, when it says Copied */
  label?: string;
  /** where a refused copy goes */
  onError?: (error: unknown) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("No clipboard in this browser");
      await navigator.clipboard.writeText(value);
    } catch (error) {
      if (!onError) throw error;
      onError(error);
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <Tooltip open={open || copied} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          data-slot="copy-button"
          variant="ghost"
          size="icon-xs"
          aria-label={copied ? "Copied" : label}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            className
          )}
          onClick={copy}
          {...props}
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span className={copied ? "text-success" : undefined}>
          {copied ? "Copied" : label}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export { CopyButton };
