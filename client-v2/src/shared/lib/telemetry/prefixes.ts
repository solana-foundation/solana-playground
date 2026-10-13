/** Slice name to the prefix its event names start with; a prefix is never reused */
export const EVENT_PREFIXES = {
  auth: "auth",
  "layout-shell": "layout",
  observability: "obs",
} as const;

export type EventPrefix = typeof EVENT_PREFIXES[keyof typeof EVENT_PREFIXES];
