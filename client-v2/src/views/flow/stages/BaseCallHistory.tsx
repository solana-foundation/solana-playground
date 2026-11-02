import { ExternalLink } from "lucide-react";

import { StatusDot } from "@/shared/ui/status-dot";
import type { CallRecord } from "../state/call-history";

export interface BaseCallHistoryProps {
  /** Newest first, already filtered to this program and network */
  records: CallRecord[];
  cluster: string;
  txUrl: (signature: string) => string;
  /** Picks the row's instruction in the form */
  onOpen: (instruction: string) => void;
}

const shortSig = (sig: string) => `${sig.slice(0, 4)}…${sig.slice(-4)}`;

/** The calls made to this program on this network, newest first */
const BaseCallHistory = ({
  records,
  cluster,
  txUrl,
  onOpen,
}: BaseCallHistoryProps) => {
  if (records.length === 0) return null;
  return (
    <section aria-label="Call history" className="flex flex-col gap-2">
      <h3 className="m-0 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        Call history
      </h3>
      <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border p-0">
        {records.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs"
          >
            <StatusDot variant={r.ok ? "success" : "error"} />
            <button
              type="button"
              aria-label={`Open ${r.instruction}`}
              onClick={() => onOpen(r.instruction)}
              className="cursor-pointer rounded font-mono text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
    </section>
  );
};

export default BaseCallHistory;
