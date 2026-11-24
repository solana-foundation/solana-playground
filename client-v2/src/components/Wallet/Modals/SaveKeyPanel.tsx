import { Button } from "@/shared/ui/button";

import { KeyPanel, KeyPanelUnavailable } from "../KeyPanel";

/**
 * The button that saves a key file under the `key-origin` provider: the
 * failure line when the key could not be made, the button's place, disabled,
 * while it is made, then the key page's export panel
 */
export const SaveKeyPanel = ({
  isFailed,
  exported,
  onError,
  onBusy,
  className,
}: {
  /** Making the key failed */
  isFailed: boolean;
  /** The account whose file is saved; none while its key is made */
  exported: { publicKey: string; name: string } | undefined;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
  className?: string;
}) => {
  if (isFailed) return <KeyPanelUnavailable className={className} />;
  if (!exported) {
    return (
      <Button type="button" variant="outline" disabled className={className}>
        Save keypair
      </Button>
    );
  }
  return (
    <KeyPanel
      action="export"
      publicKey={exported.publicKey}
      name={exported.name}
      onError={onError}
      onBusy={onBusy}
      className={className}
    />
  );
};
