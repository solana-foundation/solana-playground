import { useEffect } from "react";
import { FrownIcon, InfoIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import Markdown from "../../../components/Markdown";
import { ModalFrame, useModalId } from "@/widgets/overlays";
import { PgCommon, PgConnection, PgView } from "../../../utils";

export const Local = () => {
  const id = useModalId();

  // Close when connected; by id, as another dialog may sit on this one
  useEffect(() => {
    const { dispose } = PgConnection.onDidChangeIsConnected((isConnected) => {
      if (isConnected) PgView.closeModal(null, id);
    });
    return dispose;
  }, [id]);

  return (
    <ModalFrame name="localnet-unreachable" title="Connect to localnet">
      <Callout variant="error">
        <FrownIcon />
        <CalloutDescription>Unable to connect to localnet</CalloutDescription>
      </Callout>

      <div className="pt-4 pb-2">
        <div className="text-[0.875rem] font-bold">How to connect</div>
        <div className="mt-2 text-[0.75rem] text-[var(--text-secondary)]">
          Here are the steps for connecting to localnet from playground.
        </div>

        {/* The markdown sheet resets its own margin, unlayered, so the gap
            sits on a wrapper */}
        <div className="mt-6">
          <Markdown codeFontOnly>
            {require("./steps.md")
              .replace("<OS_NAME>", PgCommon.getOS() ?? "Other")
              .replace(
                "<OS_INSTALLATION>",
                PgCommon.getOS() === "Windows"
                  ? require("./install-windows.md")
                  : require("./install-unix.md")
              )}
          </Markdown>
        </div>

        <Issues />
      </div>
    </ModalFrame>
  );
};

const Issues = () => {
  const browser = PgCommon.getBrowser();
  if (browser === "Firefox") return null;

  return (
    <Collapsible>
      <CollapsibleHeading>
        <CollapsibleChevron />
        Having issues?
      </CollapsibleHeading>
      <CollapsibleContent className="mt-2">
        <Callout variant="info">
          <InfoIcon />
          <CalloutDescription className="[&_p+p]:mt-4">
            <p>
              If you have a running test validator, it means your browser is
              blocking localhost access and you'll need to enable it in order to
              connect.
            </p>
            {browser === "Brave" && (
              <p>
                For <strong>Brave Browser</strong>: Click the Brave icon at the
                right side of the browser URL bar and drop the shields for this
                website.
              </p>
            )}
          </CalloutDescription>
        </Callout>
      </CollapsibleContent>
    </Collapsible>
  );
};
