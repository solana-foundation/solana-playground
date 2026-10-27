import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ErrorInfo, ReactNode } from "react";

import { createLogger } from "@/shared/lib/logger";
import { Modal } from "@/shared/ui/modal";
import { PgView } from "@/utils/view";
import {
  ModalDismissContext,
  ModalIdContext,
  ModalLayerContext,
} from "./modal-layer";

const log = createLogger("overlays:modal-host");

/**
 * Keeps a dialog that throws while rendering from taking the IDE with it:
 * the failure is reported, the user is told, and that dialog closes with no
 * answer, so the code awaiting it goes on. `PgView.setModal` never rejects,
 * so this is the only place that can tell the user who opened it. A dialog
 * under another still renders, so it closes by its id: the one on top is not
 * the one that failed.
 */
class ModalBoundary extends Component<
  { id: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error(error, {
      report: true,
      context: { componentStack: info.componentStack },
    });
    PgView.setToast(
      () => (
        <span>
          <strong>Could not open.</strong> Try again.
        </span>
      ),
      { options: { name: "modal-failed" } }
    );
    PgView.closeModal(null, this.props.id);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const subscribe = (onChange: () => void) =>
  PgView.onDidChangeModals(onChange).dispose;

/**
 * Renders `PgView.getOpenModals()`, the dialogs opened with
 * `PgView.openModal` or `setModal`, in the design system's `Modal`. A dialog
 * opened from another stacks on it. The one below stays mounted but draws
 * nothing: state held above its `ModalFrame` survives, the frame's own
 * subtree remounts when it is on top again. Escape, a press
 * outside and the header's Close close the top dialog with no answer, except
 * while its submit runs.
 */
export const ModalHost = () => {
  // `PgView` owns the stack, so a remount of this host shows what is open
  const modals = useSyncExternalStore(subscribe, PgView.getOpenModals);
  useEffect(() => PgView.attachModalHost().dispose, []);
  // Set by the top dialog's `ModalFrame` while its submit runs
  const dismissBlocked = useRef(false);
  const blockDismiss = useCallback((blocked: boolean) => {
    dismissBlocked.current = blocked;
  }, []);

  return (
    <Modal
      open={modals.length > 0}
      onOpenChange={(open) => {
        if (!open && !dismissBlocked.current) PgView.closeTopModal();
      }}
    >
      <ModalDismissContext.Provider value={blockDismiss}>
        {modals.map((modal, i) => (
          <ModalIdContext.Provider key={modal.id} value={modal.id}>
            <ModalLayerContext.Provider value={i === modals.length - 1}>
              <ModalBoundary id={modal.id}>
                {PgView.normalizeElement(modal.elementable, modal.props)}
              </ModalBoundary>
            </ModalLayerContext.Provider>
          </ModalIdContext.Provider>
        ))}
      </ModalDismissContext.Provider>
    </Modal>
  );
};
