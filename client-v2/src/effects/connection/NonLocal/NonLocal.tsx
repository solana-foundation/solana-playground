import { FC, useEffect } from "react";

import { Button } from "@/shared/ui/button";
import { Endpoint } from "../../../constants";
import { PgConnection, PgSettings, PgView } from "../../../utils";
import type { ToastChildProps } from "../../../utils/view";

export const NonLocal: FC<React.PropsWithChildren<ToastChildProps>> = ({
  id,
}) => {
  // Close the toast if the user changes the cluster
  useEffect(() => {
    let isInitial = true;
    let prevCluster = PgConnection.cluster;
    const changeCluster = PgConnection.onDidChangeCluster((cluster) => {
      // Only close the toast if it's not initial and it's a different cluster
      if (!isInitial && prevCluster !== cluster) PgView.closeToast(id);
      isInitial = false;
      prevCluster = cluster;
    });

    const changeIsClusterDown = PgConnection.onDidChangeIsClusterDown(
      (isClusterDown) => {
        // Anything other than `isClusterDown === false` means either the cluster
        // is down, or there is a connection error, which means we don't need to
        // close the toast.
        if (!isInitial && isClusterDown === false) PgView.closeToast(id);
      }
    );

    return () => {
      changeCluster.dispose();
      changeIsClusterDown.dispose();
    };
  }, [id]);

  return (
    <div>
      <div>
        <div>Switch to localnet?</div>
        <div className="mt-1 text-[0.75rem] text-[var(--text-secondary)]">
          Current endpoint is not responsive.
        </div>
      </div>

      <div className="mt-4 flex justify-end [&>button]:ml-4">
        <Button
          onClick={() => (PgSettings.connection.endpoint = Endpoint.LOCALNET)}
          variant="ghost"
          size="sm"
        >
          Yes
        </Button>
        <Button variant="ghost" size="sm">
          No
        </Button>
      </div>
    </div>
  );
};
