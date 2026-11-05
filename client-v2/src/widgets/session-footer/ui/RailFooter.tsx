import type { ReactNode } from "react";

import type { SettingsRequest } from "@/shared/lib/settings-request";

import BaseRailFooter from "./BaseRailFooter";
import { useAccount } from "./use-account";

interface RailFooterProps {
  /** The status row's dots (`widgets/status`) */
  status: ReactNode;
  onToggleSettings: (request: SettingsRequest) => void;
}

/** `BaseRailFooter` on the live cluster, session, wallet and feedback */
const RailFooter = ({ status, onToggleSettings }: RailFooterProps) => {
  const { account, menu, dialog, onMenuOpenChange, accountRef } = useAccount({
    from: "rail",
    onToggleSettings,
  });
  // The funding dialog sits beside the footer, so it outlives the menu
  return (
    <>
      <BaseRailFooter
        account={account}
        status={status}
        menu={menu}
        onMenuOpenChange={onMenuOpenChange}
        accountRef={accountRef}
      />
      {dialog}
    </>
  );
};

export default RailFooter;
