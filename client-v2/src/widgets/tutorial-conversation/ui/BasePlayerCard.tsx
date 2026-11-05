import { TreePine, Zap } from "lucide-react";

import { shortKey } from "@/shared/lib/short-key";
import { cn } from "@/shared/lib/utils";

/** m:ss, for the time until the next energy */
export const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export interface BasePlayerCardProps {
  address: string;
  energy: number;
  max: number;
  wood: number;
  /** ms until the next energy comes back, while one is on its way */
  nextMs?: number;
  className?: string;
}

/**
 * The player account as a game's screen would draw it: its address, the energy
 * as a thin meter with the number beside it, and the wood. It has no box of its
 * own: it sits inside the card that acted on it.
 */
const BasePlayerCard = ({
  address,
  energy,
  max,
  wood,
  nextMs,
  className,
}: BasePlayerCardProps) => {
  const isEmpty = energy === 0;
  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        <span className="text-foreground">Player account</span>
        <span
          className="min-w-0 truncate font-mono text-[0.75rem]"
          title={address}
        >
          {shortKey(address)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div
          role="img"
          className="flex items-center gap-2"
          aria-label={`${energy} of ${max} energy`}
        >
          <Zap
            aria-hidden="true"
            className={cn(
              "size-3.5",
              isEmpty ? "text-error" : "text-brand-green"
            )}
          />
          <span aria-hidden="true" className="flex gap-0.5">
            {Array.from({ length: max }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 w-3 rounded-full transition-colors duration-300 motion-reduce:transition-none",
                  i < energy ? "bg-brand-green" : "bg-foreground/10"
                )}
              />
            ))}
          </span>
          <span
            className={cn(
              "font-mono text-[0.8125rem] tabular-nums",
              isEmpty ? "text-error" : "text-foreground"
            )}
          >
            {energy}/{max}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <TreePine
            aria-hidden="true"
            className="size-3.5 text-muted-foreground"
          />
          <span className="font-mono text-[0.8125rem] text-foreground tabular-nums">
            {wood}
          </span>
          <span className="text-caption text-muted-foreground">wood</span>
        </div>
      </div>
      {nextMs !== undefined && (
        <p className="mt-2 text-caption text-muted-foreground tabular-nums">
          Next energy in{" "}
          <span className="font-mono text-foreground">{clock(nextMs)}</span>
          <span className="text-subtle">
            {" "}
            · worked out by the client, no transaction
          </span>
        </p>
      )}
    </div>
  );
};

export default BasePlayerCard;
