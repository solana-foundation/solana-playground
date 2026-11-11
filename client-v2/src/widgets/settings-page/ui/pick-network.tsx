import { PgGlobal, PgSettings, PgView } from "@/utils";

import { canSwitchNetwork, networkHeldBy } from "../model/network-hold";

/** Say what holds the network where it is: a deploy or an IDL write */
export const toastNetworkHeld = () => {
  if (networkHeldBy(PgGlobal) === "idl") {
    PgView.setToast(
      () => (
        <span>
          An anchor idl command is running. Change the network when it ends.
        </span>
      ),
      { options: { name: "network-held-by-idl" } }
    );
    return;
  }
  PgView.setToast(
    () => <span>A deploy is running. Change the network when it ends.</span>,
    { options: { name: "network-held-by-deploy" } }
  );
};

/**
 * Move the network to `url`; false, with a toast, while a deploy or an IDL
 * write holds it. Every switch the user asks for goes through here: Settings
 * and the Deploy stage's "Show <network>" link.
 */
export const pickNetwork = (url: string): boolean => {
  if (!canSwitchNetwork(PgGlobal)) {
    toastNetworkHeld();
    return false;
  }
  PgSettings.connection.endpoint = url;
  return true;
};
