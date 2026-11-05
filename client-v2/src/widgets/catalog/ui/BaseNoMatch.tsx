import { Search } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/ui/empty";

export interface BaseNoMatchProps {
  /** The list's things, plural and lowercase: "tutorials", "programs" */
  label: string;
  query: string;
  /** Empties the search field, so the whole list shows again */
  onClear: () => void;
}

/**
 * A search that matched nothing (Spec 08's EMPTY-09), never a load
 * failure's red (NET-07). Set as most search pages set it (NotebookLM,
 * Revolut, Relume): right under the field, on a soft fill the width of the
 * grid with no frame of its own, a plain magnifier, the title a clear step
 * above the line, and one quiet way back.
 */
const BaseNoMatch = ({ label, query, onClear }: BaseNoMatchProps) => (
  // Spaced by group, as the editor's no-files state: the icon 12 px over the
  // title, the title and its line a tight pair, the action 24 px below
  <Empty className="flex-none gap-6 bg-surface-panel px-6 py-10">
    <EmptyHeader className="gap-1">
      <EmptyMedia className="mb-2 text-muted-foreground">
        <Search className="size-6" aria-hidden />
      </EmptyMedia>
      <EmptyTitle
        role="heading"
        aria-level={2}
        className="text-lg leading-tight text-foreground"
      >
        {`No ${label} match “${query}”`}
      </EmptyTitle>
      <EmptyDescription className="font-read">
        Try a shorter word.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button
        variant="outline"
        className="pointer-coarse:h-11 pointer-coarse:px-5"
        onClick={onClear}
      >
        Clear search
      </Button>
    </EmptyContent>
  </Empty>
);

export default BaseNoMatch;
