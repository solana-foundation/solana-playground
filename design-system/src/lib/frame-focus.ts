import type * as React from "react"

/**
 * What Tab can land on, in document order. A roving item (tabindex -1) and
 * anything hidden from assistive tech (Radix's native select behind its
 * trigger) are left out, as the browser's own Tab order leaves them.
 */
const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
]
  .map((selector) => `${selector}:not([tabindex="-1"])`)
  .join(", ")

/**
 * A modal overlay's `onKeyDown`: Shift+Tab from the content's own frame goes
 * to its last control. Radix focuses the frame when the content opens with no
 * control to take focus, or after a press on its body, and its focus trap
 * wraps only from the first control, so from the frame the key went nowhere.
 */
function shiftTabFromFrame(event: React.KeyboardEvent<HTMLElement>) {
  const frame = event.currentTarget
  if (event.key !== "Tab" || !event.shiftKey || event.target !== frame) return
  const last = Array.from(frame.querySelectorAll<HTMLElement>(TABBABLE))
    .filter(
      (el) =>
        !el.closest('[aria-hidden="true"]') && (el.checkVisibility?.() ?? true)
    )
    .at(-1)
  if (!last) return
  event.preventDefault()
  last.focus()
}

export { shiftTabFromFrame }
