import type { SettingsRequest } from "@/shared/lib/settings-request";
import BaseSessionFooter from "./BaseSessionFooter";
import { useAccount } from "./use-account";

interface SessionFooterProps {
  settingsOpen: boolean;
  onToggleSettings: (request: SettingsRequest) => void;
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
        onOpenCluster={() =>
          onToggleSettings({ from: "cluster", focus: "network" })
        }
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
