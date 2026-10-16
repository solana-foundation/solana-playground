import type { SettingsFocus } from "@/views/flow/settings/GearSidebar";
import BaseRailFooter from "./BaseRailFooter";
import { useAccount } from "./use-account";

interface RailFooterProps {
  settingsOpen: boolean;
  onToggleSettings: (focus?: SettingsFocus) => void;
}

/** `BaseRailFooter` on the live cluster, session, wallet and feedback */
const RailFooter = ({ settingsOpen, onToggleSettings }: RailFooterProps) => {
  const { account, menu, dialog, onMenuOpenChange, accountRef } = useAccount({
    from: "rail",
    onToggleSettings,
  });
  return (
    <>
      <BaseRailFooter
        account={account}
        settingsOpen={settingsOpen}
        onOpenCluster={() => onToggleSettings("network")}
        menu={menu}
        onMenuOpenChange={onMenuOpenChange}
        accountRef={accountRef}
      />
      {dialog}
    </>
  );
};

export default RailFooter;
