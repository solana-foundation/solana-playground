import { useEffect, useRef, useState } from "react";

import { PgView } from "@/utils";

import { onDidRequestFundDialog } from "../model/open";
import { currentReceiver } from "../model/receiver";
import type { FundFrom } from "../model/telemetry";
import FundDialog from "./FundDialog";

/** Why "Send from your wallet" opened nothing: no Playground wallet to fund */
const NoReceiverToast = () => (
  <span>Make a Playground wallet first: it is the wallet you send SOL to.</span>
);

/**
 * The one Fund dialog: every entry (the account menu, the wallet chip, the
 * short-wallet cards and the faucet-refused toast) opens it through
 * `openFundDialog`. Mounted once beside the toasts, so it outlives a toast
 * or a menu, and a send pending from one entry holds Send off for the next.
 */
const FundDialogHost = () => {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<FundFrom>("deploy-card");

  // A request while the dialog is open changes nothing: a new `from` would
  // count a second opening and reset what the user picked. With no
  // Playground wallet to fund the dialog would draw nothing and stay "open",
  // swallowing every later request, so it says why instead
  const isOpen = useRef(open);
  isOpen.current = open;
  useEffect(
    () =>
      onDidRequestFundDialog((next) => {
        if (isOpen.current) return;
        if (!currentReceiver()) {
          PgView.setToast(NoReceiverToast, {
            options: { name: "fund-no-receiver" },
          });
          return;
        }
        setFrom(next);
        setOpen(true);
      }),
    []
  );

  return <FundDialog open={open} onOpenChange={setOpen} from={from} />;
};

export default FundDialogHost;
