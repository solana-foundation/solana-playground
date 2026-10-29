import { useRef } from "react";
import type {
  ComponentProps,
  KeyboardEvent,
  ReactNode,
  SyntheticEvent,
} from "react";
import { cn } from "@/shared/lib/utils";

import { BrandButton } from "@/shared/ui/brand-button";
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

/**
 * The design system's sizes: `narrow` is for a form of one column (Connect a
 * model), `wide` for dialogs with a code or a table in the body
 */
export type ModalSize = NonNullable<
  ComponentProps<typeof ModalContent>["size"]
>;

/**
 * What has the focus when the dialog opens: the body's first field (or the
 * submit, when there is none), or the dialog itself, for one that should open with no field
 * ringed, as the prototype's New project does
 */
export type OpenFocus = "field" | "dialog";

/**
 * How the submit is drawn: the stock `Button`'s `default` or `destructive`,
 * or `brand`, the ring `BrandButton`, for a dialog whose submit is its view's
 * one call to action
 */
export type SubmitVariant = "default" | "destructive" | "brand";

/** Whether the submit can be pressed, and why not */
export type SubmitStatus = "ready" | "disabled" | "busy";

export type BaseModalFrameProps = {
  /** The heading; `hidden` keeps it as the dialog's name only */
  title: { text: string; hidden: boolean };
  /** Why the last submit failed */
  error?: string;
  /**
   * Below `LAYOUT_BREAKPOINTS.phone`, where the dialog is a page: the bar's
   * Close is the way out, so there is no Cancel, and the one action is the
   * flat accent across the foot, as the prototype's phone pins it
   */
  phone?: boolean;
  /** The footer; a dialog without one has only the header's Close */
  submit?: {
    text: string;
    status: SubmitStatus;
    variant: SubmitVariant;
    onSubmit: () => void;
    /** Shown as a Cancel button beside the submit */
    onCancel?: () => void;
  };
  size: ModalSize;
  /** Where the focus lands on open; `field` when left out */
  openFocus?: OpenFocus;
  /**
   * Runs once the dialog's content unmounts; Radix would send focus to the
   * dialog's `Trigger`, and `preventDefault()` stops it
   */
  onCloseAutoFocus?: (event: Event) => void;
  children?: ReactNode;
};

/**
 * What a field needs to be one the user can reach: enabled and in the tab
 * order. Radix keeps a native control beside a radio group or a select inside
 * a form, `aria-hidden` and out of the tab order, which must not take focus.
 */
const REACHABLE =
  ':not(:disabled):not([aria-hidden="true"]):not([tabindex="-1"])';

/** A field of the body that takes focus when the dialog opens */
const FIRST_FIELD = [
  `[data-slot="modal-body"] input:not([type="hidden"]):not([type="file"])${REACHABLE}`,
  `[data-slot="modal-body"] textarea${REACHABLE}`,
  `[data-slot="modal-body"] select${REACHABLE}`,
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
 * field. With `openFocus` set to `dialog`, the dialog itself has it instead.
 */
export const BaseModalFrame = ({
  title,
  error,
  phone = false,
  submit,
  size,
  openFocus = "field",
  onCloseAutoFocus,
  children,
}: BaseModalFrameProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const canSubmit = submit?.status === "ready";
  /** What either kind of submit button shows */
  const submitLabel = submit && (
    <>
      {submit.status === "busy" && <Spinner />}
      {submit.text}
    </>
  );

  const handleSubmit = (ev: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    ev.preventDefault();
    // Any button in the body without `type="button"` submits the form too;
    // only the footer's button is the dialog's submit
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
  // dialog; Enter must submit, so focus the body's first field or the submit,
  // or the dialog itself when asked
  const handleOpenAutoFocus = (ev: Event) => {
    if (openFocus === "dialog") {
      // Radix dispatches this on the content, which takes focus at -1; on
      // anything else its own default focus stays
      if (!(ev.currentTarget instanceof HTMLElement)) return;
      ev.preventDefault();
      ev.currentTarget.focus();
      return;
    }
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
      onCloseAutoFocus={onCloseAutoFocus}
      onPointerDownOutside={keepOpenForToast}
      onInteractOutside={keepOpenForToast}
      onKeyDown={handleKeyDown}
    >
      <form
        ref={formRef}
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={handleSubmit}
      >
        {/* A hidden title draws no hairline on a desk; a phone's bar keeps
            its edge */}
        <ModalHeader className={cn(title.hidden && "md:border-b-0")}>
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
            {submit.onCancel && !phone && (
              <Button
                type="button"
                variant="ghost"
                disabled={submit.status === "busy"}
                onClick={submit.onCancel}
              >
                Cancel
              </Button>
            )}
            {submit.variant === "brand" ? (
              <BrandButton
                ref={submitRef}
                type="submit"
                variant={phone ? "accent" : "ring"}
                className={phone ? "h-12 rounded-xl text-control" : undefined}
                disabled={!canSubmit}
              >
                {submitLabel}
              </BrandButton>
            ) : (
              <Button
                ref={submitRef}
                type="submit"
                variant={submit.variant}
                disabled={!canSubmit}
              >
                {submitLabel}
              </Button>
            )}
          </ModalFooter>
        )}
      </form>
    </ModalContent>
  );
};
