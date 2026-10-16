/** Slice name to the prefix its event names start with; a prefix is never reused */
export const EVENT_PREFIXES = {
  auth: "auth",
  feedback: "feedback",
  "layout-shell": "layout",
  observability: "obs",
  persistence: "sync",
} as const;

export type EventPrefix = typeof EVENT_PREFIXES[keyof typeof EVENT_PREFIXES];
