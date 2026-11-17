# Changelog

What changed in the components, newest first. One line per fix; the ticket
id says where the decision lives.

## 2026-11-11 · A busy button keeps its width (HOO-2795)

- AsyncButton: with a `loadingText`, the idle label and the busy one (the
  spinner and `loadingText`) share one grid cell, and the one not shown is
  `invisible` and `aria-hidden`. The button is as wide as the wider of the two
  at all times, so a row beside it no longer moves when the wait starts or
  ends. Each label follows the button's own alignment, so a `justify-start`
  caller stays flush left. The busy spinner there carries no `data-icon`
  (the busy button keeps the plain padding) and is `aria-hidden`, so the
  busy name is `loadingText` alone; while the busy label is hidden, the
  spinner does not spin. Without a
  `loadingText` it is unchanged.

## 2026-11-07 · The lockup's mark alone (HOO-2725)

- Logo: `LogoLockupMark`, the lockup's triangle-and-circle mark without the
  words, its box cropped to the mark. The folded navigation wears it at its
  head, as the prototype's rail does.

## 2026-11-07 · Overlays release focus before hiding the page (HOO-2684)

- Dialog, Modal, Sheet, DropdownMenu, ContextMenu, Select: the content blurs
  focus left outside it as it mounts (`useReleaseFocus`). Radix hid the page
  with `aria-hidden` a render before moving focus in, so with the editor
  focused Chrome refused the attribute and the page stayed reachable behind
  the overlay. Where focus goes on close is unchanged: ContextMenu, which
  returns it to what held it before, gets it back through `returnFocus`.

## 2026-11-05 · Core components polish (DES-129)

- Input, Textarea, Select, NativeSelect: a hover state. The border lifts to
  `muted-foreground/60`; a disabled or invalid field keeps its own border.
- Checkbox, RadioGroupItem: a hover state. Unchecked, the border lifts as on
  a field; checked, the fill goes to `primary/80`, as on the default Button.
- Switch: a hover state. Off, the track goes to `muted-foreground/40`; on, to
  `primary/80`. A disabled switch does not react.
- Segmented `chips`: hover lifts the border to `border-strong`, as `gradient`
  already did.
- AsyncButton: while it waits it keeps its full colour instead of dimming to
  the disabled 50%, so busy reads apart from unavailable. It still takes no
  clicks.
