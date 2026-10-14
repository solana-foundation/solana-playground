import { useRenderOnChange } from "../../../hooks";
import { PgSession } from "../../../features/auth";
import type { SettingsFocus } from "../settings/GearSidebar";
import BaseRailFooter from "./BaseRailFooter";
import { useClusterStatus } from "./use-cluster-status";

interface RailFooterProps {
  settingsOpen: boolean;
  onToggleSettings: (focus?: SettingsFocus) => void;
  onExpand: () => void;
}

/** `BaseRailFooter` on the live cluster status and the signed-in user */
const RailFooter = ({
  settingsOpen,
  onToggleSettings,
  onExpand,
}: RailFooterProps) => {
  const cluster = useClusterStatus();
  useRenderOnChange(PgSession.onDidChange);

  return (
    <BaseRailFooter
      cluster={cluster}
      settingsOpen={settingsOpen}
      avatar={PgSession.get()?.image ?? null}
      onOpenCluster={() => onToggleSettings("network")}
      onExpand={onExpand}
    />
  );
};

export default RailFooter;
