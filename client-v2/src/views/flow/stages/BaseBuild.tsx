import { CircleAlert, CircleCheck, CircleX, History } from "lucide-react";
import type { FocusEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { BrandButton, BrandButtonIcon } from "@/shared/ui/brand-button";
import { Button } from "@/shared/ui/button";
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
  StageEmptyProgress,
  StageEmptyTitle,
} from "@/shared/ui/stage-empty";

import {
  EMPTY_SOURCE_HINT,
  fileLabel,
} from "../../../commands/build/empty-source";
import type { BuildFailure } from "../state/stage";
import type { BuildSurface } from "./build-surface";
import type { DiagnosticView, FailedView } from "./build-view";
import { errorMeta, msLabel, warningCount } from "./build-view";
import {
  STAGE_BODY,
  STAGE_FOOT,
  STAGE_FRAME,
  STAGE_REPORT,
} from "./stage-layout";
import { SLOW_BUILD_MS } from "./use-slow-build";

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
  /** How long the running build has run, `null` while none runs */
  elapsedMs: number | undefined;
  /** The browser has no network: Build waits, and the notice over the stage
   * says why (Spec 08 NET-01) */
  offline: boolean;
  onBuild: () => unknown;
  onContinue: () => void;
  /** `PgProgramInfo` holds an IDL; never a stable build server's, which produces none */
  hasIdl: boolean;
  /** The code changed after the build on screen: Build again leads */
  sourceChanged: boolean;
  /** Sends a prompt to the assistant: an error card's Explain or Fix */
  onAsk: (prompt: string) => void;
  onOpenFile: (path: string) => void;
  /** Opens the console, where the terminal holds the whole output */
  onShowLog: () => void;
  /** Signs in with GitHub, which the Foundation's server asks for, then builds */
  onSignIn: () => unknown;
  /** Stops the build in flight, as the console's Stop does */
  onStop: () => void;
  /** The build's downloads (IDL, program binary), links under Build succeeded's pills */
  idlActions: ReactNode;
  /** "Build the IDL locally": in Download IDL's place without an IDL, after the downloads with one */
  idlGuide: ReactNode;
}

/**
 * What a surface ends with: its own action row, or, while a run with no
 * known end goes on, the moving bar and the run's way out. Never both: a
 * running surface has nothing to press but Stop and the log.
 */
type SurfaceEnd =
  | {
      /** A run in flight: a moving bar under the meta, Stop and the log */
      run: Pick<BaseBuildProps, "onStop" | "onShowLog">;
      actions?: never;
    }
  | { run?: never; actions?: ReactNode };

/** Marks the control focus goes to when a surface swap drops it; one per surface */
const FOCUS_HERE = { "data-stage-focus": "" } as const;

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
  progress,
  report = false,
  announce,
  ...end
}: {
  icon?: ReactNode;
  title: string;
  meta?: string | null;
  description?: ReactNode;
  children?: ReactNode;
  /** The run behind the surface's Build button, for the slow line */
  progress?: Pick<BaseBuildProps, "building" | "slow">;
  report?: boolean;
  /**
   * How the description is announced. `alert`: it is why the stage stopped,
   * read the moment it shows, as the error callout it replaced was (Spec 08).
   * `status`: it says how the run goes, politely; mounted before the run, so
   * its first change (the run started) is heard, then its slow line.
   */
  announce?: "alert" | "status";
} & SurfaceEnd) => {
  const actions = end.run ? (
    <>
      <Button variant="outline" {...FOCUS_HERE} onClick={end.run.onStop}>
        Stop
      </Button>
      <LogLink onShowLog={end.run.onShowLog} />
    </>
  ) : (
    end.actions
  );
  return (
    <div className={STAGE_FRAME}>
      <StageEmpty
        className={cn(
          STAGE_BODY,
          report && STAGE_REPORT,
          // No action row to push to the foot on a phone: the words take the
          // middle, not the foot
          !actions && "max-md:[&>:last-child]:mb-auto"
        )}
      >
        {icon && <StageEmptyMedia>{icon}</StageEmptyMedia>}
        {/* Focusable from code only: where focus lands when the surface
            that held it is replaced. No ring: the heading is not a control,
            and a screen reader reads it out */}
        <StageEmptyTitle tabIndex={-1} className="outline-none">
          {title}
        </StageEmptyTitle>
        {meta && <StageEmptyMeta>{meta}</StageEmptyMeta>}
        {end.run && <StageEmptyProgress />}
        {description && (
          <StageEmptyDescription role={announce}>
            {description}
          </StageEmptyDescription>
        )}
        {children}
        {progress?.building && <SlowLine slow={progress.slow} />}
        {actions && (
          <StageEmptyActions className={STAGE_FOOT}>
            {actions}
          </StageEmptyActions>
        )}
      </StageEmpty>
    </div>
  );
};

/**
 * "Show full log" as a link under the row's button, as Deploy's Upload IDL.
 * Full width, so the row wraps and the link takes a line of its own.
 */
const LogLink = ({ onShowLog }: Pick<BaseBuildProps, "onShowLog">) => (
  <div className="flex w-full justify-center">
    <Button variant="link" onClick={onShowLog}>
      Show full log
    </Button>
  </div>
);

/**
 * Spec 08 BUILD-05, mounted for the whole run so its polite region is in
 * place before the words arrive. Never a warning colour: slow is not broken.
 */
const SlowLine = ({ slow }: { slow: boolean }) => (
  <p role="status" className="text-sm text-muted-foreground">
    {slow
      ? "This build is taking longer than usual. The server may be busy. It keeps running."
      : ""}
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
    disabled={p.offline}
    onClick={p.onBuild}
    onError={reportButtonFailure("build")}
  >
    {label}
  </AsyncButton>
);

const ContinueButton = ({ p }: { p: BaseBuildProps }) => (
  <BrandButton onClick={p.onContinue}>Continue to Deploy</BrandButton>
);

/** Continue to Deploy once the build on screen is older than the code */
const OutlineContinueButton = ({ p }: { p: BaseBuildProps }) => (
  <Button variant="outline" onClick={p.onContinue}>
    Continue to Deploy
  </Button>
);

/**
 * Build as the surface's brand pill: the first build, with the play mark,
 * Try again after a build that never reached the compiler, which is that
 * surface's main action as Continue to Deploy is the success's, and Build again
 * once the code changed after a success. A
 * `BrandButton` rather than `AsyncButton`, which is a `Button` and has no
 * brand look, so the busy state and the failure report are kept here.
 */
const BrandBuildButton = ({
  p,
  label,
  icon = false,
}: {
  p: BaseBuildProps;
  label: string;
  icon?: boolean;
}) => (
  <BrandButton
    disabled={p.building || p.offline}
    aria-busy={p.building || undefined}
    onClick={() => {
      // Through `then`, so a synchronous throw is caught as well
      Promise.resolve().then(p.onBuild).catch(reportButtonFailure("build"));
    }}
  >
    {p.building ? "Building…" : label}
    {icon && !p.building && <BrandButtonIcon />}
  </BrandButton>
);

/**
 * What "Nothing built yet" says. A run in flight says where it compiles, not
 * the server's host name, which tells a learner nothing. The Foundation's
 * server took 381s on a cold first build and 2.9s on the next one (measured
 * 2026-09-21); from `SLOW_BUILD_MS` the same paragraph adds that the first
 * build is the slow one, so nothing warns about the wait before it is long.
 */
const emptyDescription = (p: BaseBuildProps) => {
  if (!p.building) {
    return "Build compiles your program on the server. Only the source leaves your browser.";
  }
  if ((p.elapsedMs ?? 0) < SLOW_BUILD_MS) {
    return "Compiling on the build server.";
  }
  return "Compiling on the build server. First builds take longer. This one is running.";
};

const Empty = (p: BaseBuildProps) => (
  <Surface
    title={p.building ? "Building…" : "Nothing built yet"}
    meta={
      p.building && p.elapsedMs !== undefined
        ? `${Math.floor(p.elapsedMs / 1000)} s`
        : null
    }
    description={emptyDescription(p)}
    // A first build says it started and that it is slow in its own words
    // (Spec 06), so it has no Spec 08 line: two would say it twice
    announce="status"
    // The bar and Stop take the button's place while it runs: a disabled
    // "Building…" only repeated the title
    {...(p.building
      ? { run: { onStop: p.onStop, onShowLog: p.onShowLog } }
      : { actions: <BrandBuildButton p={p} label="Build" icon /> })}
  />
);

/**
 * A build that never reached the compiler. A build server that never replied
 * is Spec 08's BUILD-04; an empty program file the build refused to send is
 * Spec 09's, drawn by `EmptySource`; anything else is Spec 08's ANY-00.
 * BUILD-04 keeps the server and the raw error behind "Show details"; ANY-00
 * offers "Show full log", the console, where the terminal has the whole text.
 */
const Unreached = (p: BaseBuildProps & { failure: BuildFailure | null }) => {
  if (p.failure?.kind === "empty-source") {
    return <EmptySource {...p} file={p.failure.file} />;
  }
  if (p.failure?.kind === "signed-out") return <SignedOut {...p} />;
  const noAnswer = p.failure?.kind === "no-answer";
  return (
    // No duration: a build that never ran took no time worth naming. The
    // reason is the description, as on every other surface: the red icon
    // already says it failed, so a red box under it would say it twice
    <Surface
      icon={<CircleX className="text-error" />}
      title={noAnswer ? "Build did not start" : "Could not build"}
      announce="alert"
      description={
        noAnswer
          ? "The Playground server did not answer. Your code is unchanged."
          : "The full log has the details."
      }
      actions={
        <>
          <BrandBuildButton p={p} label="Try again" />
          {/* The log is there if wanted, Try again is the way on */}
          {!noAnswer && <LogLink onShowLog={p.onShowLog} />}
        </>
      }
      progress={p}
    >
      {noAnswer && (
        <Details serverUrl={p.serverUrl} failure={p.failure?.message ?? null} />
      )}
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

/**
 * HOO-2422: the Solana Foundation's build server builds only for a signed-in
 * GitHub user. Signing in is the one action, and builds again once it is
 * done. Not a red error: nothing is wrong with the code.
 */
const SignedOut = (p: BaseBuildProps) => (
  <Surface
    title="Sign in with GitHub to build"
    description="Builds run on Playground's build server, which needs a GitHub sign-in. Your code stays in this browser."
    actions={
      <BrandButton
        onClick={() =>
          Promise.resolve()
            .then(p.onSignIn)
            .catch(reportButtonFailure("sign in"))
        }
      >
        Sign in with GitHub
      </BrandButton>
    }
    progress={p}
  />
);

/** What BUILD-04 keeps out of its first line: the server and the raw error */
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

const noIdlLine = (hasIdl: boolean) =>
  hasIdl
    ? "The Playground's stable build server produces no IDL, so Interact keeps the IDL it already holds."
    : "The Playground's stable build server produces no IDL: build it locally and upload it to call the program from Interact.";

const successLine = ({ sourceChanged, hasIdl }: BaseBuildProps) => {
  const lead = sourceChanged
    ? "Your code changed after the last build. Build again before you deploy."
    : "The program is ready to deploy.";
  return `${lead} ${noIdlLine(hasIdl)}`;
};

const Succeeded = (p: BaseBuildProps) => (
  <Surface
    icon={<CircleCheck className="text-success" />}
    title="Build succeeded"
    meta={p.ms === null ? undefined : `Built in ${msLabel(p.ms)}`}
    description={successLine(p)}
    actions={
      <>
        {/* What comes next: go on, or build again once the code moved on.
            Export project is not here: it is a project action, in Settings
            and the explorer, not a build result */}
        {p.sourceChanged ? (
          <>
            <BrandBuildButton p={p} label="Build again" />
            <OutlineContinueButton p={p} />
          </>
        ) : (
          <>
            <ContinueButton p={p} />
            <BuildButton p={p} label="Build again" variant="outline" />
          </>
        )}
        {/* The stage's downloads, as links under the pills like
            Unreached's Show full log. Download IDL draws itself only while
            the app holds an IDL; without one, the guide takes its place */}
        <div className="flex w-full flex-wrap justify-center gap-2">
          {p.idlActions}
          {/* One place in the tree, moved by order: a guide that moved in the
              tree when its own drop loaded an IDL would remount and close */}
          <div className={p.hasIdl ? "order-last" : "order-first"}>
            {p.idlGuide}
          </div>
        </div>
      </>
    }
    progress={p}
  />
);

/**
 * One compiler error, with Spec 04's Explain and Fix. Every card's are the
 * same outline buttons (Slava, 3 Nov): a brand Explain on the first card read
 * as that error mattering more. Neither moves focus: the answer arrives in the
 * side panel.
 */
const ErrorCard = ({
  view,
  onAsk,
  onOpenFile,
}: {
  view: DiagnosticView;
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAsk(view.prompts.explain)}
        >
          Explain
        </Button>
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

/**
 * Puts focus back in the stage when a surface swap removed the element that
 * held it (Build giving way to Stop, Stop to the next surface): on the new
 * surface's `FOCUS_HERE` control, else its title. Focus the person moved out
 * of the stage stays where they put it. Keyed on the surface and the run
 * only: a swap inside one surface (a card's details) keeps its own focus.
 */
const useKeptFocus = (key: string) => {
  const root = useRef<HTMLDivElement>(null);
  const hasFocusInside = useRef(false);

  // A press anywhere outside the stage lets go at once, even on something
  // that takes no focus: a removal fires no press, so the two never mix
  useEffect(() => {
    const press = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node))
        hasFocusInside.current = false;
    };
    document.addEventListener("pointerdown", press, true);
    return () => document.removeEventListener("pointerdown", press, true);
  }, []);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !hasFocusInside.current) return;
    const active = document.activeElement;
    if (active && active !== document.body) {
      // Still in the stage, or something outside took it meanwhile
      if (!el.contains(active)) hasFocusInside.current = false;
      return;
    }
    // Two queries: one selector list would return the title, which comes first
    (
      el.querySelector<HTMLElement>("[data-stage-focus]") ??
      el.querySelector<HTMLElement>('[data-slot="stage-empty-title"]')
    )?.focus();
  }, [key]);

  return {
    ref: root,
    onFocus: () => {
      hasFocusInside.current = true;
    },
    // Focus moving to another element outside lets go; moving to nothing is
    // a removal or the window losing focus, and keeps it
    onBlur: (e: FocusEvent) => {
      const next = e.relatedTarget;
      if (next && !root.current?.contains(next as Node))
        hasFocusInside.current = false;
    },
  };
};

/** The Build stage, drawn from props alone; `Build` connects it */
const BaseBuild = (p: BaseBuildProps) => {
  const kept = useKeptFocus(`${p.surface.kind}:${p.building}`);
  return (
    // `contents`: the frame inside keeps the stage's height
    <div className="contents" {...kept}>
      <BaseBuildSurface {...p} />
    </div>
  );
};

const BaseBuildSurface = (p: BaseBuildProps) => {
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
