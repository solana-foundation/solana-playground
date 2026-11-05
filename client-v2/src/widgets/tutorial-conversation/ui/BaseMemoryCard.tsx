import { HardDrive, MemoryStick } from "lucide-react";

import { shortKey } from "@/shared/lib/short-key";
import { cn } from "@/shared/lib/utils";

import { BLOCK, HEAP, KB } from "../model/account-card";

const kb = (bytes: number) =>
  `${(bytes / KB).toLocaleString("en-US", { maximumFractionDigits: 1 })} KB`;

const LABEL =
  "flex items-center gap-2 text-caption text-muted-foreground [&>svg]:size-3.5";
// Mono at 12 sits level with the 13px labels
const VALUE =
  "text-right font-mono text-[0.75rem] whitespace-nowrap tabular-nums";

/** The account's bytes as 10 KB blocks, the size realloc adds at a time */
const Blocks = ({ size, capacity }: { size: number; capacity: number }) => (
  <span aria-hidden="true" className="flex gap-0.5">
    {Array.from({ length: Math.ceil(capacity / BLOCK) }, (_, i) => (
      <span
        key={i}
        data-testid="memory-block"
        data-filled={(i + 1) * BLOCK <= size}
        className={cn(
          "h-1 flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none",
          (i + 1) * BLOCK <= size ? "bg-brand-green" : "bg-foreground/15"
        )}
      />
    ))}
  </span>
);

/**
 * What reading the account takes from the heap, on the account's own scale. A
 * tick marks where the 32 KB heap ends, so a copy too big for it runs past the
 * tick, red.
 */
const HeapBar = ({ used, capacity }: { used: number; capacity: number }) => {
  const pct = (n: number) => `${Math.min(100, (n / capacity) * 100)}%`;
  return (
    <span
      className="relative flex h-2.5 items-center"
      title="The heap ends at 32 KB"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 h-1 rounded-full bg-foreground/15"
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 h-1 rounded-full transition-[width] duration-300 motion-reduce:transition-none",
          used > HEAP ? "bg-error" : "bg-foreground/45"
        )}
        style={{ width: pct(used) }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-y-0 w-px -translate-x-1/2 rounded-full bg-foreground/60"
        style={{ left: pct(HEAP) }}
      />
    </span>
  );
};

export interface BaseMemoryCardProps {
  address: string;
  size: number;
  capacity: number;
  /** What a read takes from the heap; none leaves the row out */
  heap?: number;
  /** Read in place: the zero copy map */
  zero: boolean;
  className?: string;
}

/**
 * An account as the runtime sees it: its size in 10 KB blocks and what reading
 * it takes from the 32 KB heap, both on one scale so the copy and the heap
 * compare by length.
 */
const BaseMemoryCard = ({
  address,
  size,
  capacity,
  heap,
  zero,
  className,
}: BaseMemoryCardProps) => {
  const isOver = heap !== undefined && heap > HEAP;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        <span className="font-act text-foreground">
          {zero ? "Big map · zero copy" : "Map account"}
        </span>
        <span
          className="min-w-0 truncate font-mono text-[0.75rem]"
          title={address}
        >
          {shortKey(address)}
        </span>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
        <span className={LABEL}>
          <HardDrive aria-hidden="true" />
          Account
        </span>
        <Blocks size={size} capacity={capacity} />
        <span className={cn(VALUE, "text-foreground")}>
          {kb(size)} / {kb(capacity)}
        </span>
        {heap !== undefined && (
          <>
            <span className={cn(LABEL, isOver && "[&>svg]:text-error")}>
              <MemoryStick aria-hidden="true" />
              Heap
            </span>
            <HeapBar used={heap} capacity={capacity} />
            <span
              className={cn(VALUE, isOver ? "text-error" : "text-foreground")}
            >
              {zero ? "0 KB, in place" : `${kb(heap)} / 32 KB`}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export default BaseMemoryCard;
