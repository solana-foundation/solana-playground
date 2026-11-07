import {
  Check,
  ChevronDown,
  CircleX,
  Clock,
  Copy,
  ExternalLink,
  Play,
  Send,
} from "lucide-react";
import type { FC, KeyboardEvent } from "react";
import { useEffect, useState } from "react";

import type {
  CallPanelTab,
  CallView,
  RunResult,
} from "@/features/tutorial-conversation";
import { devnetExplorerUrl } from "@/shared/lib/devnet-explorer";
import { PROGRAM_LOG, programLogText } from "@/shared/lib/program-log";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";
import { CopyButton } from "@/shared/ui/copy-button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/ui/empty";
import { Input } from "@/shared/ui/input";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";
import { Spinner } from "@/shared/ui/spinner";
import { Tag } from "@/shared/ui/tag";

/** Every band's content stops here, on one left edge */
const CAP = "w-full max-w-[720px]";
/** The result's quiet controls and its sentence, in one size and grey */
const QUIET =
  "h-auto gap-1.5 p-0 text-[0.875rem] leading-[1.125rem] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground";

type TxResult = Extract<RunResult, { act: "run" | "call" }>;

/** One quiet sentence of how the call went */
const sentenceOf = (result: Extract<TxResult, { ok: true }>) => {
  const { computeUnits, fee } = result.receipt ?? {};
  const parts: string[] = [];
  if (computeUnits !== undefined) {
    parts.push(`used ${computeUnits.toLocaleString("en-US")} compute units`);
  }
  if (fee !== undefined) {
    parts.push(`the fee was ${fee / 1e9} test SOL from your wallet`);
  }
  if (parts.length === 2) return `The call ${parts[0]}, and ${parts[1]}.`;
  if (computeUnits !== undefined) return `The call ${parts[0]}.`;
  if (fee !== undefined) return `The ${parts[0].slice(4)}.`;
  return undefined;
};

/**
 * A call devnet has not read back yet (HOO-2675): sent, not failed, so muted
 * and not red, as the act card shows it. Check again reads what it sent; Call
 * stays off, since sending again would repeat the call and its fee
 */
const UnconfirmedResult: FC<{
  result: Extract<TxResult, { reason: "unconfirmed" }>;
  onRecheck: (() => void) | undefined;
}> = ({ result, onRecheck }) => {
  const last = result.unconfirmed[result.unconfirmed.length - 1];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Clock
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="font-heading text-[1rem] leading-6 font-medium text-foreground">
          Not confirmed yet
        </span>
      </div>
      <p className="text-[0.875rem] leading-[1.125rem] text-muted-foreground">
        {result.message}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {onRecheck && <Button onClick={onRecheck}>Check again</Button>}
        {last && (
          <Button variant="ghost" size="xs" className={QUIET} asChild>
            <a
              href={devnetExplorerUrl({ kind: "tx", value: last.signature })}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
              Explorer
            </a>
          </Button>
        )}
      </div>
    </div>
  );
};

/**
 * A finished call as the prototype's `Confirmed` sets it: the status alone
 * (the request right above names the call), what came back on a well, and
 * the sentence with one row of quiet controls under it.
 */
const CallResult: FC<{
  result: RunResult;
  /** The line for an account the goal creates that was already there */
  exists: string | undefined;
}> = ({ result, exists }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  // eslint-disable-next-line unicorn/no-null -- React.FC takes null, not undefined
  if (result.act !== "call") return null;
  // An account the goal creates, already there, passes: no red
  const failed = !result.ok && exists === undefined;
  const signature = result.ok
    ? result.signatures[result.signatures.length - 1]
    : undefined;
  const said = result.ok && result.line !== null;
  let words = result.ok
    ? said && `${PROGRAM_LOG}${programLogText(result.line ?? "")}`
    : result.message;
  if (exists !== undefined) words = exists.replaceAll("`", "");
  let status = failed ? "Failed" : "Confirmed";
  if (exists !== undefined) status = "Already exists";
  const failedLog = !result.ok && result.log ? result.log.split("\n") : [];
  const log = result.ok ? result.receipt?.log ?? [] : failedLog;
  const sentence = result.ok ? sentenceOf(result) : undefined;
  const handleCopy = () =>
    signature &&
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(signature))
      .then(() => setCopied(true))
      .catch(reportButtonFailure("copy the signature"));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {failed ? (
          <CircleX aria-hidden="true" className="size-4 shrink-0 text-error" />
        ) : (
          <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
        )}
        <span className="font-heading text-[1rem] leading-6 font-medium text-foreground">
          {status}
        </span>
      </div>
      {words && (
        <p
          className={cn(
            "rounded-control bg-surface-well px-3 py-2.5 font-mono text-[0.8125rem] leading-5 break-words",
            failed ? "text-error" : "text-foreground"
          )}
        >
          {words}
        </p>
      )}
      {sentence && (
        <p className="text-[0.875rem] leading-[1.125rem] text-muted-foreground">
          {sentence}
        </p>
      )}
      <Collapsible>
        <div className="flex flex-wrap items-center gap-4">
          {signature && (
            <>
              <Button
                variant="ghost"
                size="xs"
                className={QUIET}
                onClick={handleCopy}
              >
                {copied ? (
                  <Check aria-hidden="true" className="size-3.5" />
                ) : (
                  <Copy aria-hidden="true" className="size-3.5" />
                )}
                <span aria-live="polite">
                  {copied ? "Copied" : "Copy signature"}
                </span>
              </Button>
              <Button variant="ghost" size="xs" className={QUIET} asChild>
                <a
                  href={devnetExplorerUrl({ kind: "tx", value: signature })}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                  Explorer
                </a>
              </Button>
            </>
          )}
          {log.length > 0 && (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className={cn(QUIET, "group ml-auto")}
              >
                Log
                <ChevronDown
                  aria-hidden="true"
                  className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
                />
              </Button>
            </CollapsibleTrigger>
          )}
        </div>
        <CollapsibleContent>
          <pre className="mt-3 max-h-48 overflow-auto rounded-control bg-surface-well p-3 font-mono text-[0.75rem] leading-[1.6] text-muted-foreground">
            {log.join("\n")}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export interface BaseCallPanelProps {
  /** Undefined before any deploy: "Nothing to call yet" */
  view: CallView | undefined;
  tab: CallPanelTab;
  onTab: (tab: CallPanelTab) => void;
  onPick: (instruction: string) => void;
  onType: (arg: string, value: string) => void;
  onCall: () => void;
  /** Check again on a call devnet has not read back */
  onRecheck: () => void;
}

/**
 * The Call panel, over the editor (prototype `TestForm`): Form | IDL, the
 * request, and under it the latest call's answer. Built from the deployed
 * IDL, and only what the learner fills in is asked: no accounts.
 */
const BaseCallPanel: FC<BaseCallPanelProps> = ({
  view,
  tab,
  onTab,
  onPick,
  onType,
  onCall,
  onRecheck,
}) => {
  if (!view) {
    return (
      <div
        data-testid="tutorial-call-panel"
        className="absolute inset-0 z-10 flex min-h-0 flex-col bg-surface-base"
      >
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia className="grid size-12 place-items-center rounded-panel bg-surface-raised text-muted-foreground">
              <Send aria-hidden="true" className="size-6" />
            </EmptyMedia>
            <EmptyTitle>Nothing to call yet</EmptyTitle>
            <EmptyDescription>
              Deploy the program first. Once it is on devnet, its instructions
              show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  const { instruction } = view;
  const handleEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (view.canCall) onCall();
  };
  return (
    <div
      data-testid="tutorial-call-panel"
      className="absolute inset-0 z-10 flex min-h-0 flex-col bg-surface-base"
    >
      <div className="flex shrink-0 px-6 pt-4">
        <Segmented
          variant="boxed"
          value={tab}
          onValueChange={(v) => onTab(v as CallPanelTab)}
          aria-label="Call panel view"
          className="gap-0.5 rounded-[10px] bg-foreground/[0.04] p-[3px]"
        >
          {(["form", "idl"] as const).map((v) => (
            <SegmentedItem
              key={v}
              value={v}
              className="h-7 rounded-[7px] text-[0.8125rem] data-[state=on]:bg-foreground/[0.08]"
            >
              {v === "form" ? "Form" : "IDL"}
            </SegmentedItem>
          ))}
        </Segmented>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {tab === "idl" ? (
          <div className={cn("flex min-h-0 flex-1 flex-col gap-2 px-6 py-4")}>
            <p className="text-caption text-muted-foreground">
              The form is built from this IDL, so a new deploy changes both.
            </p>
            <div className={cn("relative flex min-h-0 flex-1 flex-col", CAP)}>
              <pre
                tabIndex={0}
                aria-label="IDL JSON, read only"
                className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-control border border-border bg-surface-well px-3 py-2 font-mono text-[0.75rem] leading-[1.6] text-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {view.json}
              </pre>
              <CopyButton
                value={view.json}
                label="Copy IDL"
                onError={reportButtonFailure("copy the IDL")}
                className="absolute top-1.5 right-1.5 bg-surface-well"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-8 px-6 pt-4 pb-8">
            <section
              aria-label="Request"
              className={cn("flex flex-col gap-4", CAP)}
            >
              {view.chips.length > 0 && (
                <Segmented
                  variant="chips"
                  value={instruction}
                  onValueChange={onPick}
                  aria-label="Instruction"
                >
                  {view.chips.map((chip) => (
                    <SegmentedItem
                      key={chip.name}
                      value={chip.name}
                      className="rounded-[7px] font-mono text-[0.8125rem] data-[state=on]:border-border-strong data-[state=on]:bg-foreground/[0.08]"
                    >
                      {chip.name}
                      {chip.isNew && (
                        <Tag variant="neutral" className="ml-1.5 h-4">
                          New
                        </Tag>
                      )}
                    </SegmentedItem>
                  ))}
                </Segmented>
              )}
              <div className="mb-2 flex flex-col gap-1">
                <h3 className="font-mono text-[0.9375rem] leading-[1.35] font-medium break-words">
                  <span className="font-normal text-muted-foreground">
                    {view.program}.
                  </span>
                  <span className="text-syntax-function">{instruction}</span>
                  <span className="text-foreground">{view.signature}</span>
                </h3>
                <p className="text-caption text-muted-foreground">
                  In code{" "}
                  <code className="ml-1 font-mono text-[0.8125rem] break-words text-foreground/80">
                    {view.code}
                  </code>
                </p>
              </div>
              {view.fields.map((field) => (
                <label
                  key={field.name}
                  className={cn(
                    "flex flex-col gap-2",
                    field.isNew && "animate-rise motion-reduce:animate-none",
                    view.calling && "pointer-events-none opacity-60"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[0.8125rem] text-foreground">
                      {field.name}
                    </span>
                    {field.isNew && <Tag variant="neutral">New</Tag>}
                  </span>
                  <Input
                    value={field.value}
                    placeholder={field.type}
                    aria-label={`${field.name}, ${field.type}`}
                    inputMode={field.numeric ? "numeric" : undefined}
                    maxLength={field.max}
                    readOnly={view.calling}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore
                    data-form-type="other"
                    onChange={(e) => onType(field.name, e.target.value)}
                    onKeyDown={handleEnter}
                    className="h-10 w-full max-w-[360px] min-w-0 font-mono text-[0.8125rem] md:text-[0.8125rem]"
                  />
                </label>
              ))}
              <div className="mt-2 flex flex-col items-start gap-2">
                {view.note && (
                  <p
                    id="call-note"
                    className="max-w-[64ch] text-caption text-muted-foreground"
                  >
                    {view.note}
                  </p>
                )}
                <Button
                  disabled={!view.canCall}
                  aria-describedby={view.note ? "call-note" : undefined}
                  onClick={onCall}
                >
                  {view.calling ? (
                    <Spinner aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" className="size-3 fill-current" />
                  )}
                  {view.calling ? "Calling" : `Call ${instruction}`}
                </Button>
              </div>
            </section>
            <section
              aria-label="Response"
              aria-live="polite"
              className="flex w-full max-w-[560px] flex-col gap-2"
            >
              {view.calling ? (
                <div className="flex items-center gap-2">
                  <Spinner
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                  />
                  <span className="font-heading text-[0.9375rem] font-medium text-foreground">
                    Sending
                  </span>
                </div>
              ) : (
                view.result && (
                  <>
                    {view.stale && (
                      <p className="text-caption text-muted-foreground">
                        {view.stale}
                      </p>
                    )}
                    <div className={cn(view.stale && "opacity-60")}>
                      {view.result.act === "call" &&
                      !view.result.ok &&
                      view.result.reason === "unconfirmed" ? (
                        <UnconfirmedResult
                          result={view.result}
                          onRecheck={view.canRecheck ? onRecheck : undefined}
                        />
                      ) : (
                        <CallResult result={view.result} exists={view.exists} />
                      )}
                    </div>
                  </>
                )
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

export default BaseCallPanel;
