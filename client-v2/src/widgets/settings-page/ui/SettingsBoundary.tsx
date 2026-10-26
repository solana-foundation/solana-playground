import { useEffect } from "react";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

import { LoggerErrorBoundary } from "@/shared/lib/logger";
import type { SettingsExit } from "@/shared/lib/settings-request";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";

type OnClose = (via: Exclude<SettingsExit, "key">) => void;

/**
 * In place of a page that failed to render. Escape leaves it as it leaves
 * the page: the page's own listener went with the tree that threw.
 */
const SettingsFailed = ({ onClose }: { onClose: OnClose }) => {
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !ev.defaultPrevented) onClose("escape");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="region"
      aria-label="Settings"
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background p-6 text-foreground"
    >
      <Callout variant="error" className="max-w-md">
        <CalloutDescription>
          The settings could not be shown.
        </CalloutDescription>
      </Callout>
      <Button variant="outline" onClick={() => onClose("back")} autoFocus>
        <ChevronLeft data-icon="inline-start" />
        Back to app
      </Button>
    </div>
  );
};

/**
 * Keeps a setting that throws as it renders (a malformed `values` entry, a
 * Custom value with no `custom`) from unmounting the app hidden under the
 * page: the page gives way to a notice with "Back to app", and the error is
 * reported through the logger's `panic`. Mounted with the page, so the next
 * open starts fresh.
 */
const SettingsBoundary = ({
  onClose,
  children,
}: {
  onClose: OnClose;
  children: ReactNode;
}) => (
  <LoggerErrorBoundary fallback={<SettingsFailed onClose={onClose} />}>
    {children}
  </LoggerErrorBoundary>
);

export default SettingsBoundary;
