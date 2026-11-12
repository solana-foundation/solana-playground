import { ExternalLink } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { StatusDot } from "@/shared/ui/status-dot";

import type { CallRecord } from "../state/call-history";

export interface BaseCallHistoryProps {
  /** Newest first, already filtered to this program and network */
  records: CallRecord[];
  cluster: string;
  txUrl: (signature: string) => string;
  /** Opens the row's instruction card and brings it into view */
  onOpen: (instruction: string) => void;
  /**
   * Keep the heading and an empty line before the first call, for a layout
   * that holds a column for the history; otherwise nothing renders until then
   */
  showEmpty?: boolean;
  className?: string;
}

const shortSig = (sig: string) => `${sig.slice(0, 4)}…${sig.slice(-4)}`;

/** The calls made to this program on this network, newest first */
const BaseCallHistory = ({
  records,
  cluster,
  txUrl,
  onOpen,
  showEmpty,
  className,
}: BaseCallHistoryProps) => {
  // eslint-disable-next-line unicorn/no-null -- a React component renders nothing with null
  if (records.length === 0 && !showEmpty) return null;
  return (
    <section
      aria-label="Call history"
      className={cn("@container/history flex flex-col gap-2", className)}
    >
      <h3 className="m-0 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        Call history
      </h3>
      {records.length === 0 ? (
        // Spec 08's EMPTY-05: a quiet note in the list's own frame, so the
        // column keeps its shape when the first call lands; the title a
        // step above its line, as the nav's empty project list sets them
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface-panel/60 px-3 py-3">
          <p className="m-0 text-sm font-medium text-foreground">
            No calls yet
          </p>
          <p className="m-0 text-xs/normal font-read text-muted-foreground">
            Calls you make here show with their result.
          </p>
        </div>
      ) : (
        <ul className="m-0 flex min-h-0 list-none flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border p-0">
          {records.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs"
            >
              <StatusDot variant={r.ok ? "success" : "error"} />
              {/* In a narrow column the name takes its own line, so every row
                  breaks at the same place: its basis is the row less the dot
                  (size-1.5) and the gap after it (gap-x-3), 1.125rem, rounded up */}
              <button
                type="button"
                aria-label={`Open ${r.instruction}`}
                onClick={() => onOpen(r.instruction)}
                className="cursor-pointer rounded text-left font-mono text-foreground hover:underline @max-[24rem]/history:basis-[calc(100%-1.25rem)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {r.instruction}
              </button>
              <span className="text-muted-foreground">
                {r.ok ? "Succeeded" : "Failed"}
              </span>
              <time
                dateTime={new Date(r.at).toISOString()}
                className="text-subtle tabular-nums"
              >
                {new Date(r.at).toLocaleTimeString()}
              </time>
              {r.signature && (
                <a
                  href={txUrl(r.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View ${r.signature} on Explorer (${cluster})`}
                  className="ml-auto inline-flex items-center gap-1 font-mono text-muted-foreground hover:text-foreground"
                >
                  {shortSig(r.signature)}
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default BaseCallHistory;
