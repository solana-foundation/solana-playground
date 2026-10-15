import { useRef } from "react";
import type { KeyboardEvent, ReactNode, SyntheticEvent } from "react";
import { cn } from "cn";

import { Button } from "@/shared/ui/button";
import {
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@/shared/ui/modal";
import { Spinner } from "@/shared/ui/spinner";
import { isInsideToast } from "@/shared/lib/toast-layer";

/** `wide` is for dialogs with a code or a table in the body */
export type ModalSize = "default" | "wide";

/** Whether the submit can be pressed, and why not */
export type SubmitStatus = "ready" | "disabled" | "busy";

export type BaseModalFrameProps = {
  /** The heading; `hidden` keeps it as the dialog's name only */
  title: { text: string; hidden: boolean };
  /** Why the last submit failed */
  error?: string;
  /** The footer; a dialog without one has only the header's Close */
  submit?: {
    text: string;
    status: SubmitStatus;
    variant: "default" | "destructive";
    onSubmit: () => void;
    /** Shown as a Cancel button beside the submit */
    onCancel?: () => void;
  };
  size: ModalSize;
  children?: ReactNode;
};

/** A field of the body that takes focus when the dialog opens */
const FIRST_FIELD = [
  '[data-slot="modal-body"] input:not([type="hidden"]):not([type="file"]):not(:disabled)',
  '[data-slot="modal-body"] textarea:not(:disabled)',
  '[data-slot="modal-body"] select:not(:disabled)',
].join(", ");

/**
 * Where Enter already means something else: a button presses itself, a
 * textarea breaks the line, a select or a list moves its choice, a link
 * follows itself.
 */
const OWNS_ENTER =
  'button, textarea, select, a[href], [contenteditable="true"], [role="combobox"], [role="listbox"], [role="option"], [role="menu"], [role="menuitem"]';

/**
 * A dialog's content: its heading, the last error, the body and the buttons.
 * Render it inside the `Modal` root that `ModalHost` renders (it draws the
 * content, and the root the overlay). Enter anywhere in the dialog submits,
 * except on a control that owns Enter (`OWNS_ENTER`); so does the footer's
 * `type="submit"` button, which has the focus on open when the body has no
 * field.
 */
export const BaseModalFrame = ({
  title,
  error,
  submit,
  size,
  children,
}: BaseModalFrameProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const canSubmit = submit?.status === "ready";

  const handleSubmit = (ev: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    ev.preventDefault();
    // Legacy buttons in a body render a bare `<button>`, which submits the
    // form too; only the footer's button is the dialog's submit
    if (ev.nativeEvent.submitter !== submitRef.current) return;
    if (submit?.status === "ready") submit.onSubmit();
  };

  // Toasts sit over dialogs; using one is not a click away from the dialog
  const keepOpenForToast = (ev: {
    target: EventTarget | null;
    preventDefault: () => void;
  }) => {
    if (isInsideToast(ev.target)) ev.preventDefault();
  };

  // On the content, not the form: a click on a part of the body that takes
  // no focus (a framework card) leaves the focus on the content itself
  const handleKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== "Enter" || ev.defaultPrevented) return;
    if (ev.nativeEvent.isComposing) return;
    if (ev.target instanceof Element && ev.target.closest(OWNS_ENTER)) return;
    // The browser's own Enter in an input would press the form's first
    // submit button, which can be a bare `<button>` in the body
    ev.preventDefault();
    if (submit?.status === "ready") submit.onSubmit();
  };

  // Radix focuses the header's Close first, where Enter would close the
  // dialog; Enter must submit, so focus the body's first field or the submit
  const handleOpenAutoFocus = (ev: Event) => {
    const target =
      formRef.current?.querySelector<HTMLElement>(FIRST_FIELD) ??
      submitRef.current;
    if (!target || (target as HTMLButtonElement).disabled) return;
    ev.preventDefault();
    target.focus();
  };

  return (
    <ModalContent
      size={size}
      aria-describedby={undefined}
      onOpenAutoFocus={handleOpenAutoFocus}
      onPointerDownOutside={keepOpenForToast}
      onInteractOutside={keepOpenForToast}
      onKeyDown={handleKeyDown}
    >
      <form
        ref={formRef}
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={handleSubmit}
      >
        <ModalHeader>
          <ModalTitle className={cn(title.hidden && "sr-only")}>
            {title.text}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          {error && (
            <p role="alert" className="mb-4 text-caption text-destructive">
              {error}
            </p>
          )}
          {children}
        </ModalBody>
        {submit && (
          <ModalFooter>
            {submit.onCancel && (
              <Button
                type="button"
                variant="ghost"
                disabled={submit.status === "busy"}
                onClick={submit.onCancel}
              >
                Cancel
              </Button>
            )}
            <Button
              ref={submitRef}
              type="submit"
              variant={submit.variant}
              disabled={!canSubmit}
            >
              {submit.status === "busy" && <Spinner />}
              {submit.text}
            </Button>
          </ModalFooter>
        )}
      </form>
    </ModalContent>
  );
};
