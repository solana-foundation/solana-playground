import type { Page } from "@playwright/test";

/**
 * The telemetry event lines the page logs from now on.
 *
 * The dev server logs each event at `debug` from the `telemetry:event`
 * namespace, as `[telemetry:event] <name> {<params>}`.
 */
export const linesOn = (page: Page) => {
  const lines: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[telemetry:event]")) lines.push(text);
  });
  return lines;
};

/** The first event line with this name, params included */
export const lineOf = (lines: string[], name: string) =>
  lines.find((line) => line.startsWith(`[telemetry:event] ${name} `));
