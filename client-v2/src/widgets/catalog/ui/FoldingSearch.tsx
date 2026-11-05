import { Search } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/shared/ui/input-group";

export interface FoldingSearchProps {
  /** The list's things, plural and lowercase; names the field */
  label: string;
  placeholder: string;
  query: string;
  onQuery: (query: string) => void;
  /** Open on a phone: the field takes the row */
  open: boolean;
  onOpen: (open: boolean) => void;
}

/**
 * The Tutorials page's search, as the tutorial-v2 prototype folds it
 * (`desktop/Gallery.tsx`, `TutorialsBody`): a field on a wide screen, a 44 px
 * glass on a phone that opens into the whole row, with Cancel to give it back.
 * The field is put back on the page inside the press and focused there: a phone
 * raises its keyboard only for a focus the tap made. Folded on a phone it is
 * `invisible`, so neither Tab nor a screen reader finds a field nobody can see.
 */
const FoldingSearch = ({
  label,
  placeholder,
  query,
  onQuery,
  open,
  onOpen,
}: FoldingSearchProps) => {
  const input = useRef<HTMLInputElement>(null);
  const glass = useRef<HTMLButtonElement>(null);
  // A hidden field holds no focus, or a keyboard keeps typing into it. Whatever
  // folded it: Esc, Cancel, or a query cleared after the window narrowed
  useLayoutEffect(() => {
    const el = input.current;
    if (open || !el || getComputedStyle(el).visibility !== "hidden") return;
    el.blur();
  }, [open]);
  const fold = () => {
    flushSync(() => onOpen(false));
    glass.current?.focus();
  };
  const handleGlass = () => {
    flushSync(() => onOpen(true));
    input.current?.focus();
  };
  const handleCancel = () => {
    onQuery("");
    fold();
  };
  return (
    <>
      <InputGroup
        className={cn(
          "relative w-80 max-w-80",
          open
            ? "max-md:h-11 max-md:w-auto max-md:max-w-none max-md:min-w-0 max-md:flex-1 max-md:rounded-[10px]"
            : // With no filter after it, the glass's glyph meets the gutter
              "max-md:size-11 max-md:justify-center max-md:border-transparent max-md:bg-transparent max-md:last:-mr-[11px] max-md:dark:bg-transparent"
        )}
      >
        <InputGroupAddon
          className={cn(!open && "max-md:p-0 max-md:text-muted-foreground/80")}
        >
          <Search
            strokeWidth={1.5}
            aria-hidden="true"
            className={cn("size-4", !open && "max-md:size-[1.375rem]")}
          />
        </InputGroupAddon>
        <InputGroupInput
          ref={input}
          type="search"
          placeholder={placeholder}
          aria-label={`Search ${label}`}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            // Esc takes back what was typed, then the open row
            if (e.key !== "Escape") return;
            if (query) onQuery("");
            else if (open) fold();
          }}
          // 16 px on a phone: under it the browser zooms the page in on focus
          className={cn(
            "max-md:text-[1rem]",
            !open && "max-md:invisible max-md:absolute max-md:w-px"
          )}
        />
        {!open && (
          <Button
            ref={glass}
            variant="ghost"
            aria-label={`Search ${label}`}
            onClick={handleGlass}
            className="absolute inset-0 hidden size-auto rounded-[inherit] p-0 hover:bg-transparent max-md:block dark:hover:bg-transparent"
          />
        )}
      </InputGroup>
      {open && (
        <Button
          variant="ghost"
          onClick={handleCancel}
          className="-mr-2 hidden h-11 shrink-0 px-2 text-[0.9375rem] font-normal text-foreground/80 max-md:inline-flex"
        >
          Cancel
        </Button>
      )}
    </>
  );
};

export default FoldingSearch;
