import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleX, History } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { BrandButton, BrandButtonIcon } from "@/shared/ui/brand-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";
import {
  Diagnostic,
  DiagnosticCode,
  DiagnosticDescription,
  DiagnosticFooter,
  DiagnosticHeader,
  DiagnosticLine,
  DiagnosticSource,
  DiagnosticTitle,
} from "@/shared/ui/diagnostic";
import {
  StageEmpty,
  StageEmptyActions,
  StageEmptyDescription,
  StageEmptyMedia,
  StageEmptyMeta,
  StageEmptyNotice,
  StageEmptyTitle,
} from "@/shared/ui/stage-empty";
import {
  EMPTY_SOURCE_HINT,
  fileLabel,
} from "../../../commands/build/empty-source";
import { errorMeta, msLabel, warningCount } from "./build-view";
import type { BuildSurface } from "./build-surface";
import type { BuildFailure } from "../state/stage";
import type { DiagnosticView, FailedView } from "./build-view";
import {
  STAGE_BODY,
  STAGE_FOOT,
  STAGE_FRAME,
  STAGE_REPORT,
} from "./stage-layout";

/** A Build surface with what it draws: the failed one carries its errors */
export type BuildSurfaceView =
  | Exclude<BuildSurface, { kind: "failed" }>
  | ({ kind: "failed" } & FailedView);

export interface BaseBuildProps {
  surface: BuildSurfaceView;
  /** A build is running; the surface stays, its action waits */
  building: boolean;
  /** The running build is past its slow threshold (Spec 08 BUILD-05) */
  slow: boolean;
  /** The build server's host, for naming it */
  host: string;
  /** The build server's URL, for BUILD-04's details */
  serverUrl: string;
  /** The last build's duration, `null` while unknown */
  ms: number | null;
  onBuild: () => unknown;
  onContinue: () => void;
  onExport: () => unknown;
  /** Sends a prompt to the assistant: an error card's Explain or Fix */
  onAsk: (prompt: string) => void;
  onOpenFile: (path: string) => void;
  /** Download IDL, shown with a successful build */
  idlActions: ReactNode;
}

/**
 * What every surface is made of; the action row comes last. Centred, as the
 * prototype's empty stage; `report` reads from the left instead, for a
 * surface that lists the compiler's errors.
 */
const Surface = ({
  icon,
  title,
  meta,
  description,
  children,
  actions,
  progress,
  report = false,
}: {
  icon?: ReactNode;
  title: string;
  meta?: string | null;
  description?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  /** The run behind the surface's Build button, for the slow line */
  progress?: Pick<BaseBuildProps, "building" | "slow">;
  report?: boolean;
}) => (
  <div className={STAGE_FRAME}>
    <StageEmpty className={cn(STAGE_BODY, report && STAGE_REPORT)}>
      {icon && <StageEmptyMedia>{icon}</StageEmptyMedia>}
      <StageEmptyTitle>{title}</StageEmptyTitle>
      {meta && <StageEmptyMeta>{meta}</StageEmptyMeta>}
      {description && (
        <StageEmptyDescription>{description}</StageEmptyDescription>
      )}
      {children}
      {progress?.building && <SlowLine slow={progress.slow} />}
      <StageEmptyActions className={STAGE_FOOT}>{actions}</StageEmptyActions>
    </StageEmpty>
  </div>
);

/**
 * Spec 08 BUILD-05, mounted for the whole run so its polite region is in
 * place before the words arrive. Never a warning colour: slow is not broken.
 */
const SlowLine = ({ slow }: { slow: boolean }) => (
  <p role="status" className="text-sm text-muted-foreground">
    {slow ? "This build is taking longer than usual." : ""}
  </p>
);

/** The stage's own Build button, under whichever label the surface gives */
const BuildButton = ({
  p,
  label,
  variant,
}: {
  p: BaseBuildProps;
  label: string;
  variant?: "outline";
}) => (
  <AsyncButton
    variant={variant}
    loading={p.building}
    loadingText="Building…"
    onClick={p.onBuild}
    onError={reportButtonFailure("build")}
  >
    {label}
  </AsyncButton>
);

const ContinueButton = ({ p }: { p: BaseBuildProps }) => (
  <BrandButton onClick={p.onContinue}>Continue to Deploy</BrandButton>
);

/**
 * The first build: the prototype's brand pill with the play mark. A
 * `BrandButton` rather than `AsyncButton`, which is a `Button` and has no
 * brand look, so the busy state and the failure report are kept here.
 */
const FirstBuildButton = ({ p }: { p: BaseBuildProps }) => (
  <BrandButton
    disabled={p.building}
    aria-busy={p.building || undefined}
    onClick={() => {
      // Through `then`, so a synchronous throw is caught as well
      Promise.resolve().then(p.onBuild).catch(reportButtonFailure("build"));
    }}
  >
    {p.building ? "Building…" : "Build"}
    {!p.building && <BrandButtonIcon />}
  </BrandButton>
);

const Empty = (p: BaseBuildProps) => (
  <Surface
    title={p.building ? "Building…" : "Nothing built yet"}
    description={
      // A run in flight names the server and warns about the wait. The
      // Foundation's server took 381s on a cold first build and 2.9s on the
      // next one (measured 2026-09-21); six unexplained minutes read as a
      // hang, so say the first build is the slow one.
      p.building
        ? `Compiling on ${p.host}. A first build there can take several minutes.`
        : "Build compiles your program on the server. Nothing leaves your browser except the source."
    }
    actions={<FirstBuildButton p={p} />}
    progress={p}
  />
);

/**
 * A build that never reached the compiler. A build server that never replied
 * is Spec 08's BUILD-04; an empty program file the build refused to send is
 * Spec 09's, drawn by `EmptySource`; anything else is Spec 08's ANY-00. The server
 * and the raw error sit behind "Show details"; the terminal has the full
 * text.
 */
const Unreached = (p: BaseBuildProps & { failure: BuildFailure | null }) => {
  if (p.failure?.kind === "empty-source") {
    return <EmptySource {...p} file={p.failure.file} />;
  }
  const noAnswer = p.failure?.kind === "no-answer";
  return (
    <Surface
      icon={<CircleX className="text-error" />}
      title={noAnswer ? "Build did not start" : "Could not build"}
      meta={msLabel(p.ms)}
      actions={<BuildButton p={p} label="Try again" />}
      progress={p}
    >
      <StageEmptyNotice>
        <Callout variant="error">
          <CalloutDescription>
            {noAnswer
              ? "The Playground server did not answer. Your code is unchanged."
              : "The full log has the details."}
          </CalloutDescription>
        </Callout>
      </StageEmptyNotice>
      <Details serverUrl={p.serverUrl} failure={p.failure?.message ?? null} />
    </Surface>
  );
};

/**
 * Spec 09: the program file is empty, so the build sent nothing. Writing the
 * program comes first, so opening the file is the brand action.
 */
const EmptySource = (p: BaseBuildProps & { file: string }) => {
  const name = fileLabel(p.file);
  return (
    <Surface
      title={`${name} is empty`}
      description={EMPTY_SOURCE_HINT}
      actions={
        <>
          <BrandButton onClick={() => p.onOpenFile(p.file)}>
            Open {name}
          </BrandButton>
          <BuildButton p={p} label="Build" variant="outline" />
        </>
      }
      progress={p}
    />
  );
};

/** What a build that never started keeps out of its first line: the server and the raw error */
const Details = ({
  serverUrl,
  failure,
}: {
  serverUrl: string;
  failure: string | null;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm">
          <CollapsibleChevron data-icon="inline-start" />
          {open ? "Hide" : "Show"} details
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface-well p-3 text-left font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {`Build server: ${serverUrl}`}
          {failure && `\n${failure}`}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
};

const Restored = (p: BaseBuildProps & { failed: boolean }) => (
  <Surface
    icon={<History />}
    title={p.failed ? "Last build failed" : "Built earlier"}
    description="This project was built before the page was reloaded, so the compiler's report is no longer here. Build again to see it."
    actions={
      <>
        <BuildButton p={p} label="Build" />
        {!p.failed && <ContinueButton p={p} />}
      </>
    }
    progress={p}
  />
);

const Succeeded = (p: BaseBuildProps) => (
  <Surface
    icon={<CircleCheck className="text-success" />}
    title="Build succeeded"
    meta={p.ms === null ? null : `Built in ${msLabel(p.ms)}`}
    description="The IDL below reflects this build. Deploy when ready."
    actions={
      <>
        <ContinueButton p={p} />
        {p.idlActions}
        <AsyncButton
          variant="outline"
          onClick={p.onExport}
          onError={reportButtonFailure("export the project")}
        >
          Export project
        </AsyncButton>
      </>
    }
    progress={p}
  />
);

/**
 * One compiler error, with Spec 04's Explain and Fix. A screen has one brand
 * action, so only the first error's Explain takes it; the rest are outlined.
 * Neither moves focus: the answer arrives in the side panel.
 */
const ErrorCard = ({
  view,
  explain,
  onAsk,
  onOpenFile,
}: {
  view: DiagnosticView;
  explain: "brand" | "outline";
  onAsk: (prompt: string) => void;
  onOpenFile: (path: string) => void;
}) => {
  const file = view.file;
  return (
    <Diagnostic>
      <DiagnosticHeader>
        <CircleAlert />
        <DiagnosticTitle>{view.title}</DiagnosticTitle>
        {view.code && <DiagnosticCode>{view.code}</DiagnosticCode>}
      </DiagnosticHeader>
      {view.explanation && (
        <DiagnosticDescription>{view.explanation}</DiagnosticDescription>
      )}
      {(view.lines || view.excerpt) && (
        <DiagnosticSource>
          {view.lines
            ? view.lines.map((line) => (
                // The mark is the fault's text, so a line rustc gave no
                // label still needs one: the error's own title
                <DiagnosticLine
                  key={line.num}
                  number={line.num}
                  fault={line.failing ? view.label ?? view.title : undefined}
                >
                  {line.text}
                </DiagnosticLine>
              ))
            : view.excerpt}
        </DiagnosticSource>
      )}
      <DiagnosticFooter>
        {explain === "brand" ? (
          <BrandButton size="sm" onClick={() => onAsk(view.prompts.explain)}>
            Explain
          </BrandButton>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAsk(view.prompts.explain)}
          >
            Explain
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAsk(view.prompts.fix)}
        >
          Fix
        </Button>
        {file && (
          <Button size="sm" variant="ghost" onClick={() => onOpenFile(file)}>
            Open in editor
          </Button>
        )}
      </DiagnosticFooter>
    </Diagnostic>
  );
};

/** The compiler's own words, folded away under the errors */
const CompilerOutput = ({ raw }: { raw: string }) => {
  const [open, setOpen] = useState(false);
  const warnings = warningCount(raw);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm">
          <CollapsibleChevron data-icon="inline-start" />
          {open ? "Hide" : "Show"} compiler output
          {warnings > 0 && ` · ${warnings} warning${warnings === 1 ? "" : "s"}`}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface-well p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {raw}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
};

/** What the failed surface says once Explain or Fix is pressed (Spec 04) */
const ANSWERING = "The assistant is answering in the side panel.";

/**
 * The announcement after `asks` presses. A polite region speaks only when
 * its text changes, so every other ask adds a trailing no-break space.
 */
const answeringText = (asks: number) => {
  if (asks === 0) return "";
  if (asks % 2 === 1) return ANSWERING;
  return `${ANSWERING}\u00a0`;
};

const Failed = (p: BaseBuildProps & FailedView) => {
  // A rebuild's new errors have not been asked about
  const [asks, setAsks] = useState(0);
  useEffect(() => {
    if (p.building) setAsks(0);
  }, [p.building]);
  const ask = (prompt: string) => {
    setAsks((n) => n + 1);
    p.onAsk(prompt);
  };
  return (
    <Surface
      icon={<CircleX className="text-error" />}
      title="Build failed"
      meta={errorMeta(p.errorCount, p.ms, p.host)}
      actions={<BuildButton p={p} label="Try again" variant="outline" />}
      progress={p}
      report
    >
      <div className="flex w-full flex-col gap-3.5">
        {p.diagnostics.map((view, i) => (
          <ErrorCard
            key={i}
            view={view}
            explain={i === 0 ? "brand" : "outline"}
            onAsk={ask}
            onOpenFile={p.onOpenFile}
          />
        ))}
        <CompilerOutput raw={p.raw} />
        {/* Spec 04: focus stays on the card, so say once where the answer is */}
        <p role="status" className="sr-only">
          {answeringText(asks)}
        </p>
      </div>
    </Surface>
  );
};

/** The Build stage, drawn from props alone; `Build` connects it */
const BaseBuild = (p: BaseBuildProps) => {
  const s = p.surface;
  switch (s.kind) {
    case "empty":
      return <Empty {...p} />;
    case "unreached":
      return <Unreached {...p} failure={s.failure} />;
    case "restored":
      return <Restored {...p} failed={s.failed} />;
    case "succeeded":
      return <Succeeded {...p} />;
    case "failed":
      return (
        <Failed
          {...p}
          diagnostics={s.diagnostics}
          errorCount={s.errorCount}
          raw={s.raw}
        />
      );
  }
};

export default BaseBuild;
