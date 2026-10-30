import { useCallback, useEffect, useState } from "react";

import ErrorBoundary, {
  type ErrorBoundaryChildren,
} from "../../../../components/ErrorBoundary";
import { SpinnerWithBg } from "../../../../components/Loading";
import { PgCommon, PgView } from "../../../../utils";
import { useGetAndSetStatic } from "../../../../hooks";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("view:main-primary");

const Primary = () => {
  const [el, setEl] = useState<ErrorBoundaryChildren>(null);
  const setElWithTransition = useCallback(async (el: unknown) => {
    if (PgCommon.isAsyncFunction(el)) {
      setEl(null);

      const setContent = async () => {
        setEl(
          PgCommon.callIfNeeded(
            await (el as () => unknown)()
          ) as ErrorBoundaryChildren
        );
      };

      try {
        await PgCommon.transition(setContent);
      } catch (e) {
        // Shown in place of the view, but never thrown, so React and the
        // boundary do not see it: say it here. A view put back on a remount
        // (`PgView.announceMainPrimaryUnmount`) runs its route's loader again.
        log.error(e, { report: true });
        setEl({ error: e as Error, refresh: setContent });
      }
    } else {
      setEl(PgCommon.callIfNeeded(el) as ErrorBoundaryChildren);
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
        <ErrorBoundary>{el}</ErrorBoundary>
      </SpinnerWithBg>
    </div>
  );
};

// The view fades in after a beat in which it stays invisible, so a lazy view
// never flashes half drawn (`pg-primary-fade-in` in index.css)
const VIEW_CLASSES =
  "flex [&>*:last-child]:flex-1 [&>*:last-child]:overflow-auto [&>*:last-child]:opacity-0 [&>*:last-child]:animate-[pg-primary-fade-in_250ms_linear_forwards]";

export default Primary;
