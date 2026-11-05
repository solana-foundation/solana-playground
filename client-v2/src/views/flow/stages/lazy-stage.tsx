import type { ComponentType, FC, ReactNode } from "react";
import { Component, lazy, useEffect, useRef } from "react";

import { useOnline } from "@/shared/lib/hooks/use-online";
import { createLogger } from "@/shared/lib/logger";
import { BrandButton } from "@/shared/ui/brand-button";
import { Button } from "@/shared/ui/button";
import {
  StageEmpty,
  StageEmptyActions,
  StageEmptyDescription,
  StageEmptyTitle,
} from "@/shared/ui/stage-empty";

import type { Stage } from "../state/stage";
import { STAGE_LABEL } from "../state/stage-label";
import { STAGE_BODY, STAGE_FOOT, STAGE_FRAME } from "./stage-layout";

const log = createLogger("flow:stage-load");

/** The stages that load on demand. `Write` is in the first bundle */
type LazyStageName = Exclude<Stage, "write">;

/** A stage's chunk did not arrive, as opposed to the stage's own code failing */
class StageLoadError extends Error {
  constructor(cause: unknown) {
    super("A stage failed to load", { cause });
  }
}

/** How webpack rejects an `import()` whose script or stylesheet did not arrive */
const isChunkLoadFailure = (error: unknown) =>
  error instanceof Error &&
  (error.name === "ChunkLoadError" ||
    (error as { code?: unknown }).code === "CSS_CHUNK_LOAD_FAILED");

/** Who asked for another load: what it says and reports depends on that */
type Retry = "user" | "network" | "reopen";

/** The load in progress or last finished, and why it was started */
type Attempt = {
  why: Retry | "first";
  failed?: "offline" | "online";
  /** The failure reached the screen, so opening the stage again is a new try */
  isFailureShown?: boolean;
};

type BaseStageLoadFailedProps = {
  stage: LazyStageName;
  isOnline: boolean;
  /** Try again was pressed on this visit to the stage, and failed too */
  hasRetried: boolean;
  onRetry: () => void;
  /** What Reload page does; the page's own reload unless a test passes one */
  onReload?: () => void;
};

const bodyFor = (isOnline: boolean, hasRetried: boolean) => {
  if (!isOnline) return "It hasn't loaded yet. Your code is unchanged.";
  if (hasRetried) {
    return "Reload the page to get the latest version. Your code is unchanged.";
  }
  return "Check your connection and try again. Your code is unchanged.";
};

/**
 * A stage whose code did not load, in the stage's own panel so the tabs and
 * the editor stay up. Try again stays while offline because `navigator.onLine`
 * can be wrong. With a network the file may be gone, as a new release removes
 * the old hashed ones, and only a reload recovers from that. Saved code lives in
 * IndexedDB, so a reload keeps it, but offline it would lose the app itself:
 * there is no service worker.
 */
export const BaseStageLoadFailed = ({
  stage,
  isOnline,
  hasRetried,
  onRetry,
  onReload = () => window.location.reload(),
}: BaseStageLoadFailedProps) => {
  const label = STAGE_LABEL[stage];
  return (
    <div className={STAGE_FRAME}>
      <StageEmpty className={STAGE_BODY}>
        <StageEmptyTitle>
          {isOnline ? `${label} couldn't load` : `${label} needs a connection`}
        </StageEmptyTitle>
        <StageEmptyDescription role="alert">
          {bodyFor(isOnline, hasRetried)}
        </StageEmptyDescription>
        <StageEmptyActions className={STAGE_FOOT}>
          <BrandButton onClick={onRetry}>Try again</BrandButton>
          {isOnline && (
            <Button variant="outline" onClick={onReload}>
              Reload page
            </Button>
          )}
        </StageEmptyActions>
      </StageEmpty>
    </div>
  );
};

type StageLoadFailedProps = {
  stage: LazyStageName;
  hasRetried: boolean;
  /** The load failed offline, whether or not the panel was up to see it */
  hasFailedOffline: boolean;
  onRetry: (why: Exclude<Retry, "reopen">) => void;
};

/**
 * No connection is the usual cause, and it ends by itself, so the stage retries
 * when the network returns and not before.
 */
const StageLoadFailed = ({
  stage,
  hasRetried,
  hasFailedOffline,
  onRetry,
}: StageLoadFailedProps) => {
  const isOnline = useOnline();
  const isAwaitingNetwork = useRef(hasFailedOffline || !isOnline);
  useEffect(() => {
    if (isOnline && isAwaitingNetwork.current) onRetry("network");
    isAwaitingNetwork.current = !isOnline;
  }, [isOnline, onRetry]);

  return (
    <BaseStageLoadFailed
      stage={stage}
      isOnline={isOnline}
      hasRetried={hasRetried}
      onRetry={() => onRetry("user")}
    />
  );
};

type BoundaryProps = {
  stage: LazyStageName;
  hasRetried: () => boolean;
  hasFailedOffline: () => boolean;
  /** Makes the next render of a failed stage load it again */
  reset: (why: Retry) => void;
  onOpen: () => void;
  onFailureShown: () => void;
  children: ReactNode;
};

/**
 * Shows a failed load in place. Any other error goes on to the app's boundary:
 * a stage that loaded and then threw is a bug, not a missing connection.
 */
class StageLoadBoundary extends Component<BoundaryProps, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError = (error: Error) => ({ error });

  /**
   * A boundary is new only when the stage is opened: `StrictMode` replays a mount
   * and `Suspense` hides and shows the same instance, both through the unmount
   * and mount methods, which therefore say nothing about leaving.
   */
  constructor(props: BoundaryProps) {
    super(props);
    props.onOpen();
  }

  componentDidUpdate() {
    if (this.state.error instanceof StageLoadError) this.props.onFailureShown();
  }

  componentDidMount() {
    this.componentDidUpdate();
  }

  handleRetry = (why: Retry) => {
    this.props.reset(why);
    this.setState({ error: undefined });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!(error instanceof StageLoadError)) throw error;
    return (
      <StageLoadFailed
        stage={this.props.stage}
        hasRetried={this.props.hasRetried()}
        hasFailedOffline={this.props.hasFailedOffline()}
        onRetry={this.handleRetry}
      />
    );
  }
}

/**
 * `React.lazy` for a stage, which keeps a chunk that did not arrive from taking
 * down the app. `lazy` remembers a rejection forever, so a retry needs a new one.
 * That happens only once the failure has been committed: replacing it where the
 * import fails would hand React's synchronous re-render of the error a fresh
 * `lazy`, and so a new import, without end.
 *
 * With a network, a chunk that does not arrive is ours to know about, once per
 * stage per page load. The retry a returning network starts often fails too,
 * before the route is up, and says nothing about the release.
 *
 * @param load the stage's dynamic import
 * @param stage the stage, which names it in the failed state
 * @returns the stage, to render inside a `Suspense`
 */
export const lazyStage = (
  load: () => Promise<{ default: ComponentType }>,
  stage: LazyStageName
): FC => {
  let current: Attempt = { why: "first" };
  let isReported = false;

  const attemptLoad = () =>
    lazy(() =>
      load().catch((error: unknown) => {
        if (!isChunkLoadFailure(error)) throw error;
        const isOffline = !navigator.onLine;
        current = { ...current, failed: isOffline ? "offline" : "online" };
        const context = { stage };
        if (isOffline || current.why === "network" || isReported) {
          log.warn("A stage's code did not load", { context });
        } else {
          isReported = true;
          log.error(error, { report: true, context });
        }
        throw new StageLoadError(error);
      })
    );
  let Panel = attemptLoad();
  const Current = () => <Panel />;

  const reset = (why: Retry) => {
    if (!current.failed) return;
    current = { why };
    Panel = attemptLoad();
  };

  const LazyStage: FC = () => (
    <StageLoadBoundary
      stage={stage}
      hasRetried={() => current.why === "user"}
      hasFailedOffline={() => current.failed === "offline"}
      reset={reset}
      onOpen={() => {
        if (current.isFailureShown) reset("reopen");
      }}
      onFailureShown={() => {
        current = { ...current, isFailureShown: true };
      }}
    >
      <Current />
    </StageLoadBoundary>
  );
  return LazyStage;
};
