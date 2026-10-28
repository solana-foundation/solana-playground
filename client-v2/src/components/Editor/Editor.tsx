import { useEffect, lazy, Suspense, useState } from "react";
import { SpinnerWithBg } from "../Loading";
import { PgCommon, PgExplorer } from "../../utils";

const Home = lazy(() => import("./Home"));
const Monaco = lazy(() => import("./Monaco"));

export const Editor = () => {
  const [showHome, setShowHome] = useState<boolean>();

  // Decide which editor to show
  useEffect(() => {
    const { dispose } = PgExplorer.onNeedRender(
      PgCommon.debounce(
        () => setShowHome(!PgExplorer.tabs.length),
        { delay: 50 } // To fix flickering on workspace deletion
      )
    );

    return dispose;
  }, []);

  // Save explorer metadata
  useEffect(() => {
    // Save metadata to IndexedDB every 5s
    const saveMetadataIntervalId = PgCommon.setIntervalOnFocus(() => {
      PgExplorer.saveMeta().catch();
    }, 5000);

    return () => clearInterval(saveMetadataIntervalId);
  }, []);

  if (showHome === undefined) return null;

  return (
    <Suspense fallback={<SpinnerWithBg loading size="2rem" />}>
      {/* Monaco cannot draw a background image, so its own background is
          transparent and this wrapper paints the surface under it */}
      <div className="h-full w-full overflow-auto bg-surface-panel">
        {showHome ? <Home /> : <Monaco />}
      </div>
    </Suspense>
  );
};
