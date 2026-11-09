import type {
  ComponentProps,
  KeyboardEvent,
  ReactNode,
  SyntheticEvent,
} from "react";
import { useRef } from "react";

import { isInsideToast } from "@/shared/lib/toast-layer";
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

/**
 * The design system's sizes: `narrow` is for a form of one column (Connect a
 * model), `wide` for dialogs with a code or a table in the body
 */
export type ModalSize = NonNullable<
  ComponentProps<typeof ModalContent>["size"]
>;

/**
 * What has the focus when the dialog opens: the body's first field (or the
 * submit, when there is none); the dialog itself, for one that should open
 * with no field ringed, as the prototype's New project does; or Cancel, for a
 * destructive dialog, where Enter must not confirm (the dialog itself on a
 * phone, which has no Cancel; Enter there does nothing)
 */
export type OpenFocus = "field" | "dialog" | "cancel";

/**
 * How the submit is drawn: the stock `Button`'s `default` or `destructive`,
 * or `brand`, the ring `BrandButton`, for a dialog whose submit is its view's
 * one call to action
 */
export type SubmitVariant = "default" | "outline" | "destructive" | "brand";

/**
 * Whether the submit can be pressed, and why not: `busy` while it runs,
 * `held` while another part of the dialog works (Cancel waits with it, as
 * closing would drop that work), `disabled` otherwise
 */
export type SubmitStatus = "ready" | "disabled" | "held" | "busy";

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
    /** Drawn before the label; the spinner takes its place while busy */
    icon?: ReactNode;
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

/** Whether `target` is a field of the body, where Enter means "done typing" */
const isField = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable="true"]') !== null;

/**
 * A footer button beside the brand submit: its height, size and face, so the
 * two read as one set. TODO(design-system): the kit's footer sizes
 */
const FOOTER_BUTTON =
  "h-10 rounded-full px-4 font-heading text-[0.9375rem] font-normal";

/** The foot's submit on a phone: full width, whichever button it is */
const PHONE_SUBMIT = "h-12 rounded-xl text-control";
/** The brand submit's pill on a desk; less before a leading icon */
const DESK_BRAND_SUBMIT = "px-5";
const DESK_BRAND_SUBMIT_WITH_ICON = "pr-5 pl-4";

/**
 * A dialog's content: its heading, the last error, the body and the buttons.
 * Render it inside the `Modal` root that `ModalHost` renders (it draws the
 * content, and the root the overlay). Enter anywhere in the dialog submits,
 * except on a control that owns Enter (`OWNS_ENTER`); so does the footer's
 * `type="submit"` button, which has the focus on open when the body has no
 * field. With `openFocus` set to `dialog`, the dialog itself has it instead;
 * with `cancel`, the Cancel button has it, and Enter submits only from a field.
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const canSubmit = submit?.status === "ready";
  let brandSubmitClass = DESK_BRAND_SUBMIT;
  if (submit?.icon) brandSubmitClass = DESK_BRAND_SUBMIT_WITH_ICON;
  if (phone) brandSubmitClass = PHONE_SUBMIT;
  /** What either kind of submit button shows */
  const submitLabel = submit && (
    <>
      {submit.status === "busy" ? <Spinner /> : submit.icon}
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
    // A destructive dialog confirms only by its button: on a phone, which
    // has no Cancel to hold the focus, Enter on the dialog must not delete
    if (openFocus === "cancel" && !isField(ev.target)) return;
    // The browser's own Enter in an input would press the form's first
    // submit button, which can be a bare `<button>` in the body
    ev.preventDefault();
    if (submit?.status === "ready") submit.onSubmit();
  };

  // Radix focuses the header's Close first, where Enter would close the
  // dialog; Enter must submit, so focus the body's first field or the submit,
  // the dialog itself or Cancel when asked
  const handleOpenAutoFocus = (ev: Event) => {
    if (openFocus === "cancel" && cancelRef.current) {
      ev.preventDefault();
      cancelRef.current.focus();
      return;
    }
    if (openFocus === "dialog" || openFocus === "cancel") {
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
        {/* The kit's header sits 20 above the title and 4 below it, which
            presses the title and Close onto the rule; 16 below centres both
            in their band. TODO(design-system): move into the kit's
            ModalHeader, then drop this */}
        <ModalHeader className={cn("md:pb-4", title.hidden && "md:border-b-0")}>
          {/* A title can carry a user's name with no spaces: it wraps
              anywhere rather than widen the dialog past a phone */}
          <ModalTitle
            className={cn(
              "[overflow-wrap:anywhere]",
              title.hidden && "sr-only"
            )}
          >
            {title.text}
          </ModalTitle>
        </ModalHeader>
        {/* 20 under the rule, as under the title above it: the kit's 16
            pressed the body onto the rule. TODO(design-system): the kit's */}
        <ModalBody className="md:pt-5">
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
                ref={cancelRef}
                type="button"
                variant="ghost"
                className={FOOTER_BUTTON}
                disabled={submit.status === "busy" || submit.status === "held"}
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
                // The brand size leaves room for a trailing arrow (Build's);
                // a dialog's submit has none, so its padding is even, a step
                // less before a leading icon, which reads heavier than text
                className={brandSubmitClass}
                disabled={!canSubmit}
              >
                {submitLabel}
              </BrandButton>
            ) : (
              <Button
                ref={submitRef}
                type="submit"
                variant={submit.variant}
                // The foot's height on a phone as on a desk, whatever the face
                className={phone ? PHONE_SUBMIT : FOOTER_BUTTON}
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
