import { FrownIcon, InfoIcon } from "lucide-react";
import { useEffect } from "react";

import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { ModalFrame, useModalId } from "@/widgets/overlays";

import Markdown from "../../../components/Markdown";
import { PgCommon, PgConnection, PgView } from "../../../utils";

/** How each `PgCommon.getOS` answer is written in the steps */
const OS_LABEL: Record<
  NonNullable<ReturnType<typeof PgCommon.getOS>>,
  string
> = {
  Windows: "Windows",
  MacOS: "macOS",
  Linux: "Linux",
};

export const Local = () => {
  const os = PgCommon.getOS();
  const id = useModalId();

  // Close when connected; by id, as another dialog may sit on this one
  useEffect(() => {
    const { dispose } = PgConnection.onDidChangeIsConnected((isConnected) => {
      if (isConnected) PgView.closeModal(undefined, id);
    });
    return dispose;
  }, [id]);

  return (
    <ModalFrame
      name="localnet-unreachable"
      title="Connect to Localnet"
      // No field to land on, so Radix would ring the header's Close on open
      openFocus="dialog"
    >
      <Callout variant="error">
        <FrownIcon />
        <CalloutDescription>Unable to connect to Localnet</CalloutDescription>
      </Callout>

      <div className="pt-4 pb-2">
        <div className="text-[0.875rem] font-bold">How to connect</div>
        <div className="mt-2 text-[0.75rem] text-[var(--text-secondary)]">
          Here are the steps for connecting to Localnet from Playground.
        </div>

        {/* The markdown sheet resets its own margin, unlayered, so the gap
            sits on a wrapper */}
        <div className="mt-6">
          <Markdown codeFontOnly>
            {require("./steps.md")
              .replace("<OS_NAME>", (os && OS_LABEL[os]) ?? "Other")
              .replace(
                "<OS_INSTALLATION>",
                os === "Windows"
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
  // eslint-disable-next-line unicorn/no-null -- tsc rejects a component that may return undefined (TS2786)
  if (browser === "Firefox") return null;

  return (
    <div className="mt-4">
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
    </div>
  );
};
