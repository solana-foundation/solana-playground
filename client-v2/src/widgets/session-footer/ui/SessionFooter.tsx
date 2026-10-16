import type { SettingsFocus } from "@/views/flow/settings/GearSidebar";
import BaseSessionFooter from "./BaseSessionFooter";
import { useAccount } from "./use-account";

interface SessionFooterProps {
  settingsOpen: boolean;
  onToggleSettings: (focus?: SettingsFocus) => void;
}

/** `BaseSessionFooter` on the live cluster, session, wallet and feedback */
const SessionFooter = ({
  settingsOpen,
  onToggleSettings,
}: SessionFooterProps) => {
  const { account, pick, menu, dialog, onMenuOpenChange, accountRef } =
    useAccount({ from: "footer", onToggleSettings });
  return (
    <>
      <BaseSessionFooter
        account={account}
        settingsOpen={settingsOpen}
        onOpenCluster={() => onToggleSettings("network")}
        onCancelSignIn={() => pick("cancel-sign-in")}
        menu={menu}
        onMenuOpenChange={onMenuOpenChange}
        accountRef={accountRef}
      />
      {dialog}
    </>
  );
};

export default SessionFooter;
