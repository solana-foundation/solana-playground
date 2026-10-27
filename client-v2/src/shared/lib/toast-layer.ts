/**
 * The element Sonner renders its toasts into (its own attribute). The dialogs
 * and `useOnClickOutside` read it, so a press on a toast is not "outside".
 */
export const TOASTER_SELECTOR = "[data-sonner-toaster]";

/**
 * Whether a pointer or focus event came from inside a toast. A toast sits
 * over an open dialog, so a click on it is outside the dialog and would
 * close it.
 */
export const isInsideToast = (target: EventTarget | null) =>
  target instanceof Element && target.closest(TOASTER_SELECTOR) !== null;
