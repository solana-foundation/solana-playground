import type { ConsoleMessage, Page } from "@playwright/test";

/** A logged value as Chromium previews it in `ConsoleMessage.text()`: `{key: value}`, strings unquoted */
const previewOf = (value: unknown): string => {
  if (value === null || typeof value !== "object") return String(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  const entries = Object.entries(value).map(
    ([key, field]) =>
      `${key}: ${
        field !== null && typeof field === "object"
          ? JSON.stringify(field)
          : String(field)
      }`
  );
  return `{${entries.join(", ")}}`;
};

const textOf = async (message: ConsoleMessage) => {
  const text = message.text();
  // Firefox writes an object argument as `JSHandle@object`, so the params are read back from the page
  if (!text.includes("JSHandle@")) return text;
  const values = await Promise.all(
    message.args().map((arg) => arg.jsonValue())
  );
  return values.map(previewOf).join(" ");
};

/**
 * The telemetry event lines the page logs from now on.
 *
 * The dev server logs each event at `debug` from the `telemetry:event`
 * namespace, as `[telemetry:event] <name> {<params>}`.
 */
export const linesOn = (page: Page) => {
  const lines: string[] = [];
  // One chain keeps the lines in logging order while a Firefox line waits on its params
  let queue = Promise.resolve();
  page.on("console", (message) => {
    if (!message.text().startsWith("[telemetry:event]")) return;
    queue = queue
      .then(() => textOf(message))
      // A page closed mid-read keeps the raw line, which a failing assertion then prints
      .catch(() => message.text())
      .then((text) => {
        lines.push(text);
      });
  });
  return lines;
};

/** The first event line with this name, params included */
export const lineOf = (lines: string[], name: string) =>
  lines.find((line) => line.startsWith(`[telemetry:event] ${name} `));
