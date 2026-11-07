/**
 * Whether a key press came from a field the learner types in. The feed's keys
 * (⌘↵, ⌥↑ and ⌥↓) leave those alone: in a field they move the caret or send.
 */
export const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Whether a key press reached the page with no control of its own holding
 * focus, so Enter on the page can press the live card's primary action
 */
export const nothingFocused = () => {
  const active = document.activeElement;
  return !active || active === document.body;
};
