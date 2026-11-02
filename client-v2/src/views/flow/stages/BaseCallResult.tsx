import { ExternalLink } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
import { CopyButton } from "@/shared/ui/copy-button";
import { StatusDot } from "@/shared/ui/status-dot";
import type { CallOutcome } from "./call-outcome";

export interface BaseCallResultProps {
  outcome: CallOutcome;
  /** The network the call went to, named in the Explorer link */
  cluster: string;
  txUrl: (signature: string) => string;
}

/** The last call's result under the form: how it went, its signature, its logs */
const BaseCallResult = ({ outcome, cluster, txUrl }: BaseCallResultProps) => (
  <section
    aria-label="Call result"
    aria-live="polite"
    className="flex flex-col gap-3 rounded-xl border border-border bg-surface-panel p-4"
  >
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <StatusDot variant={outcome.ok ? "success" : "error"} size="lg" />
      <span className="font-medium text-foreground">
        {outcome.ok ? "Succeeded" : "Failed"}
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {outcome.instruction}
      </span>
    </div>

    {!outcome.ok && outcome.failingLine && (
      <p className="m-0 rounded-lg border border-error/20 bg-error/[0.07] px-3 py-2 font-mono text-xs break-words text-foreground">
        {outcome.failingLine}
      </p>
    )}

    {outcome.signature && (
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-base px-3 py-2">
        <span className="shrink-0 text-caption text-subtle">Signature</span>
        <code
          className="min-w-0 flex-1 truncate font-mono text-code text-foreground"
          title={outcome.signature}
        >
          {outcome.signature}
        </code>
        <CopyButton
          value={outcome.signature}
          label="Copy signature"
          onError={reportButtonFailure("copy the signature")}
        />
        <Button size="sm" variant="ghost" asChild>
          <a
            href={txUrl(outcome.signature)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on Explorer ({cluster})
            <ExternalLink data-icon="inline-end" />
          </a>
        </Button>
      </div>
    )}

    {outcome.logs.length > 0 && (
      <Collapsible>
        <CollapsibleHeading className="text-xs">
          <CollapsibleChevron />
          Show all logs
        </CollapsibleHeading>
        <CollapsibleContent className="mt-2">
          <pre className="m-0 max-h-72 overflow-auto rounded-lg bg-surface-base p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {outcome.logs.join("\n")}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    )}
  </section>
);

export default BaseCallResult;
