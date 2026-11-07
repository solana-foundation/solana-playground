import { ChevronLeft, Ellipsis } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import ShortcutsDialog from "./ShortcutsDialog";
import StartOverDialog from "./StartOverDialog";

export interface BaseChatHeadProps {
  /** The tutorial's name */
  name: string;
  /** Back to the Tutorials page */
  onBack: () => void;
  /**
   * Clears the tutorial's progress. Absent, "Start over…" shows disabled:
   * the conversation engine (`features/tutorial-conversation`) owns what
   * starting over resets, and the feed (task 3.3) is what runs it.
   */
  onStartOver?: () => Promise<void>;
  /** Steps passed so far, which Start over's question names */
  passed?: number;
  /** Shows ⌘ and ⌥ in Keyboard shortcuts */
  mac: boolean;
}

/**
 * The chat's head, 44 px, the line every column's head shares: back to
 * Tutorials, the tutorial's name, and ⋯ with "Start over…" and "Keyboard
 * shortcuts", as the prototype's `ChatColumn` lays it out.
 */
const BaseChatHead = ({
  name,
  onBack,
  onStartOver,
  passed,
  mac,
}: BaseChatHeadProps) => {
  const [startOver, setStartOver] = useState(false);
  const [keys, setKeys] = useState(false);
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-1.5">
      <Button
        variant="ghost"
        size="sm"
        className="gap-0.5 pl-1.5 text-muted-foreground"
        onClick={onBack}
      >
        <ChevronLeft className="size-4" aria-hidden />
        Tutorials
      </Button>
      <h1 className="ml-2 min-w-0 flex-1 truncate text-[0.875rem] font-normal text-foreground">
        {name}
      </h1>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="More"
            className="text-muted-foreground"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem
            disabled={!onStartOver}
            onSelect={() => setStartOver(true)}
          >
            Start over…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setKeys(true)}>
            Keyboard shortcuts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {onStartOver && (
        <StartOverDialog
          open={startOver}
          onOpenChange={setStartOver}
          name={name}
          passed={passed}
          onConfirm={onStartOver}
        />
      )}
      <ShortcutsDialog open={keys} onOpenChange={setKeys} mac={mac} />
    </div>
  );
};

export default BaseChatHead;
