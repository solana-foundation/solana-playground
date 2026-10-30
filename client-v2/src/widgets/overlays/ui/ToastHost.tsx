import { Component, useCallback, useSyncExternalStore } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { toast } from "sonner";

import { useSetStatic } from "@/hooks/useSetStatic";
import { useIsMobile } from "@/shared/lib/hooks/use-mobile";
import { RAIL_WIDTH } from "@/shared/lib/hooks/use-viewport";
import { uuid } from "@/shared/lib/ids";
import { createLogger } from "@/shared/lib/logger";
import { Toaster } from "@/shared/ui/sonner";
import type { Elementable } from "@/utils/types";
import { PgView } from "@/utils/view";
import { DEFAULT_TOAST_DURATION } from "@/utils/view";
import type { ToastId, ToastOptions, ToastRequest } from "@/utils/view";
import { overlayTelemetry } from "../model/telemetry";

const log = createLogger("overlays:toast-host");

/** How long the toast stays; a duration that is not a positive number is a mistake, and gets the default */
const durationOf = (name: string, duration: ToastOptions["duration"]) => {
  if (duration === "persistent") return Infinity;
  if (duration === undefined) return DEFAULT_TOAST_DURATION;
  if (Number.isFinite(duration) && duration > 0) return duration;
  log.warn("toast duration is not a positive number", {
    context: { name, duration: String(duration) },
  });
  return DEFAULT_TOAST_DURATION;
};

/** A name to log for a toast's component; never its source */
const componentName = (elementable: Elementable<any>) => {
  if (typeof elementable === "function") return elementable.name || "anonymous";
  return "element";
};

/**
 * Keeps a toast that throws while rendering from taking the app with it:
 * the failure is reported and the toast closes.
 */
class ToastBoundary extends Component<
  { id: ToastId; name: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error(error, {
      report: true,
      context: { name: this.props.name, componentStack: info.componentStack },
    });
    toast.dismiss(this.props.id);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The app's theme mode, read from the `dark` class that `applyThemeMode` puts
 * on `<html>`, so the toaster follows a theme change without being told.
 */
const subscribeToMode = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
};
const modeNow = () =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

/**
 * Renders the toasts sent with `PgView.setToast` in Sonner, at the bottom
 * left and clear of the rail.
 *
 * The toaster sits above the dialogs and the Sheets (`z-[60]`,
 * over their `z-50`). The legacy layer sat under the modal backdrop; this one
 * does not, on purpose: a toast must stay visible and usable whatever is
 * open, a persistent one included. A modal
 * layer sets `pointer-events: none` on the body, so the toaster turns it back
 * on. A click on a toast over a dialog would count as outside it, so
 * `BaseModalFrame` ignores one (`isInsideToast`). The stock Sheets the layout
 * shell renders (the assistant's, the phone's Files) have no such guard: a
 * click on a toast over an open one closes it.
 */
export const ToastHost = () => {
  // Below this width the phone's pager shows, and there is no rail to clear
  const noRail = useIsMobile();
  const mode = useSyncExternalStore(subscribeToMode, modeNow);
  const show = useCallback(({ elementable, props }: ToastRequest) => {
    const options = props?.options;
    if (!options?.name) {
      log.warn("toast without a name", {
        context: { elementable: componentName(elementable) },
      });
    }
    const name = options?.name ?? "unnamed";
    // A random small int could repeat and silently replace a live toast
    const id = options?.id ?? uuid();

    // The component gets the toast's id, so it can close itself
    toast(
      <ToastBoundary id={id} name={name}>
        {PgView.normalizeElement(elementable, { ...props?.componentProps, id })}
      </ToastBoundary>,
      { id, duration: durationOf(name, options?.duration) }
    );
    overlayTelemetry.track("overlay_toast_shown", { name });
  }, []);

  useSetStatic(PgView.events.TOAST_SET, show);
  useSetStatic(PgView.events.TOAST_CLOSE, (id?: ToastId) => {
    toast.dismiss(id);
  });

  return (
    <Toaster
      className="toaster group z-[60]! pointer-events-auto"
      theme={mode}
      position="bottom-left"
      closeButton
      // The rail is a desktop part; a phone has the pager instead
      offset={{
        left: noRail ? "1rem" : `calc(${RAIL_WIDTH} + 1rem)`,
        bottom: "1rem",
      }}
      mobileOffset={{ left: "1rem", bottom: "1rem" }}
    />
  );
};
