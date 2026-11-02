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
  const { account, menu, onMenuOpenChange, accountRef } = useAccount({
    from: "rail",
    onToggleSettings,
  });
  return (
    <BaseRailFooter
      account={account}
      status={status}
      menu={menu}
      onMenuOpenChange={onMenuOpenChange}
      accountRef={accountRef}
    />
  );
};

export default RailFooter;
