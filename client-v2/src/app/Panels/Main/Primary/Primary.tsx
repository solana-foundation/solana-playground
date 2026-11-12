import { useCallback, useEffect, useRef, useState } from "react";

import { createLogger } from "@/shared/lib/logger";

import ErrorBoundary, {
  type ErrorBoundaryChildren,
} from "../../../../components/ErrorBoundary";
import { SpinnerWithBg } from "../../../../components/Loading";
import { useGetAndSetStatic } from "../../../../hooks";
import { PgCommon, PgView } from "../../../../utils";

const log = createLogger("view:main-primary");

const Primary = () => {
  const [el, setEl] = useState<ErrorBoundaryChildren>(null);
  // A view set over an error gets a boundary of its own, keyed by this
  // count: a boundary keeps an error it shows until its own Refresh, which
  // keeps the key. Over a working view the key stays, so the same view set
  // again (a route run again, as Home's path and the work's do) keeps its
  // editor mounted. A view still loading when a newer one is set never shows.
  const [view, setView] = useState(0);
  const latest = useRef(0);
  const boundary = useRef<ErrorBoundary>(null);
  const setElWithTransition = useCallback(async (nextEl: unknown) => {
    const call = ++latest.current;
    if (boundary.current?.state.error) setView(call);
    if (PgCommon.isAsyncFunction(nextEl)) {
      setEl(null);

      const setContent = async () => {
        const content = PgCommon.callIfNeeded(
          await (nextEl as () => unknown)()
        ) as ErrorBoundaryChildren;
        if (call === latest.current) setEl(content);
      };

      try {
        await PgCommon.transition(setContent);
      } catch (e) {
        // Shown in place of the view, but never thrown, so React and the
        // boundary do not see it: say it here. A view put back on a remount
        // (`PgView.announceMainPrimaryUnmount`) runs its route's loader again.
        log.error(e, { report: true });
        if (call === latest.current) {
          setEl({ error: e as Error, refresh: setContent });
        }
      }
    } else {
      setEl(PgCommon.callIfNeeded(nextEl) as ErrorBoundaryChildren);
    }
  }, []);

  useGetAndSetStatic(
    PgView.events.MAIN_PRIMARY_STATIC,
    el,
    setElWithTransition
  );

  // Declared after `useGetAndSetStatic`, so its listeners are in place when
  // the `setMainPrimary` calls this releases send `set`. The unmount lets
  // the next `Primary` to mount get this one's content back: the work
  // unmounts once no project is open, and its route does not run again.
  useEffect(() => {
    PgView.announceMainPrimaryMount();
    return () => PgView.announceMainPrimaryUnmount();
  }, []);

  return (
    <div className="pg-scrollbar-all min-h-0 flex-1 overflow-hidden rounded-[12px] border border-border bg-surface-panel">
      <SpinnerWithBg className={VIEW_CLASSES} loading={!el} size="2rem">
        <ErrorBoundary key={view} ref={boundary}>
          {el}
        </ErrorBoundary>
      </SpinnerWithBg>
    </div>
  );
};

// The view fades in after a beat in which it stays invisible, so a lazy view
// never flashes half drawn (`pg-primary-fade-in` in index.css)
const VIEW_CLASSES =
  "flex [&>*:last-child]:flex-1 [&>*:last-child]:overflow-auto [&>*:last-child]:opacity-0 [&>*:last-child]:animate-[pg-primary-fade-in_250ms_linear_forwards]";

export default Primary;
