/**
 * Whether a key press came from a field the learner types in. The feed's keys
 * (⌘↵, ⌥↑ and ⌥↓) leave those alone: in a field they move the caret or send.
 */
export const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
