const TEXT_INPUT_TYPES = new Set([
  "",
  "text",
  "search",
  "url",
  "email",
  "password",
  "number",
  "tel",
]);

/**
 * Whether the user is typing in a field outside `outside`, `active` being
 * the focused element (the document's by default). Something that would take
 * focus on its own (the editor opening a file after a late mount) leaves it
 * where it is in that case.
 */
export const isTypingElsewhere = (
  outside: Element,
  active: Element | null = document.activeElement
) => {
  if (!active || outside.contains(active)) return false;
  if (active instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(active.type);
  }
  if (active instanceof HTMLTextAreaElement) return true;
  // `=== true`: jsdom leaves `isContentEditable` undefined.
  return active instanceof HTMLElement && active.isContentEditable === true;
};
