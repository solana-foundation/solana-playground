// Import from GitHub: imports the link it is given, says why it failed, and
// counts both; a closed program picker is neither.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLogs,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

import type { LinkImport } from "../model/link-import";
import ImportFromUrl from "./ImportFromUrl";

const REPO = "https://github.com/alice/ts-client";

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  resetTelemetry();
  resetLogger();
});

const named = (name: string) =>
  sent.events.filter((e) => e.name === name).map((e) => e.params);
const field = () =>
  screen.getByLabelText<HTMLInputElement>("Import from GitHub");
const button = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: /^Import/ });

/** A link import that ends as told, once `settle` is called */
const deferred = () => {
  let settle: (outcome: LinkImport) => void = () => {};
  const importLink = vi.fn(
    () => new Promise<LinkImport>((resolve) => (settle = resolve))
  );
  return { importLink, settle: (outcome: LinkImport) => settle(outcome) };
};

const typeAndImport = async (link: string) => {
  fireEvent.change(field(), { target: { value: link } });
  await act(async () => fireEvent.click(button()));
};

it("imports the link, then hands over and counts it", async () => {
  const { importLink, settle } = deferred();
  const onRunning = vi.fn();
  const onImported = vi.fn();
  render(
    <ImportFromUrl
      importLink={importLink}
      onRunning={onRunning}
      onImported={onImported}
    />
  );

  await typeAndImport(REPO);

  expect(importLink).toHaveBeenCalledWith(REPO);
  expect(field().disabled).toBe(true);
  expect(button().disabled).toBe(true);
  expect(button().getAttribute("aria-busy")).toBe("true");
  expect(button().textContent).toBe("Importing…");
  expect(onRunning.mock.calls).toEqual([[true]]);

  await act(async () => settle({ outcome: "imported", source: "github" }));

  expect(onRunning.mock.calls).toEqual([[true], [false]]);
  expect(onImported).toHaveBeenCalledTimes(1);
  expect(named("new_project_imported")).toEqual([{ via: "github" }]);
  expect(named("new_project_import_failed")).toEqual([]);
});

it("imports on Enter, never with an empty field", async () => {
  const importLink = vi.fn(
    async (): Promise<LinkImport> => ({
      outcome: "imported",
      source: "gist",
    })
  );
  render(<ImportFromUrl importLink={importLink} />);

  expect(button().disabled).toBe(true);
  fireEvent.change(field(), { target: { value: "   " } });
  expect(button().disabled).toBe(true);
  fireEvent.keyDown(field(), { key: "Enter" });
  expect(importLink).not.toHaveBeenCalled();

  fireEvent.change(field(), { target: { value: REPO } });
  await act(async () => fireEvent.keyDown(field(), { key: "Enter" }));
  expect(importLink).toHaveBeenCalledTimes(1);
});

it("shows why it failed under the field, counts it and passes it up", async () => {
  const onFailed = vi.fn();
  const onImported = vi.fn();
  const message = "This isn't a GitHub repo or gist link.";
  render(
    <ImportFromUrl
      importLink={async () => ({
        outcome: "failed",
        source: "unknown",
        reason: "bad-link",
        message,
      })}
      onFailed={onFailed}
      onImported={onImported}
    />
  );

  await typeAndImport("https://gitlab.com/acme/escrow");

  expect(screen.getByText(message)).toBeTruthy();
  expect(field().getAttribute("aria-invalid")).toBe("true");
  expect(field().disabled).toBe(false);
  expect(onFailed).toHaveBeenCalledWith(message);
  expect(onImported).not.toHaveBeenCalled();
  expect(named("new_project_import_failed")).toEqual([
    { via: "unknown", reason: "bad-link" },
  ]);
  // The user's own link: a warning, not a report
  expect(logged.entries.map((e) => e.report ?? false)).toEqual([false]);

  // Editing the link clears what went wrong
  fireEvent.change(field(), { target: { value: REPO } });
  expect(screen.queryByText(message)).toBeNull();
  expect(field().hasAttribute("aria-invalid")).toBe(false);
});

it("reports a failure that is not the link's", async () => {
  render(
    <ImportFromUrl
      importLink={async () => ({
        outcome: "failed",
        source: "github",
        reason: "unexpected",
        message: "IndexedDB is closed",
        error: new Error("500"),
      })}
    />
  );

  await typeAndImport(REPO);

  expect(logged.entries.map((e) => e.report)).toEqual([true]);
});

it("goes back to idle when the program picker is closed", async () => {
  const onImported = vi.fn();
  const onFailed = vi.fn();
  render(
    <ImportFromUrl
      importLink={async () => ({ outcome: "cancelled" })}
      onImported={onImported}
      onFailed={onFailed}
    />
  );

  await typeAndImport(REPO);

  expect(field().disabled).toBe(false);
  expect(field().hasAttribute("aria-invalid")).toBe(false);
  expect(button().textContent).toBe("Import");
  expect(onImported).not.toHaveBeenCalled();
  expect(onFailed).not.toHaveBeenCalled();
  expect(sent.events).toEqual([]);
});

it("waits while something else on the page runs", async () => {
  const importLink = vi.fn();
  render(<ImportFromUrl importLink={importLink} held />);

  fireEvent.change(field(), { target: { value: REPO } });
  expect(button().disabled).toBe(true);
  fireEvent.keyDown(field(), { key: "Enter" });
  expect(importLink).not.toHaveBeenCalled();
});

it("releases the page and says so when the import itself throws", async () => {
  const onRunning = vi.fn();
  render(
    <ImportFromUrl
      importLink={() => Promise.reject(new Error("bug"))}
      onRunning={onRunning}
    />
  );

  await typeAndImport(REPO);

  expect(onRunning.mock.calls).toEqual([[true], [false]]);
  expect(field().disabled).toBe(false);
  expect(screen.getByText("Could not import it.")).toBeTruthy();
  expect(named("new_project_import_failed")).toEqual([
    { via: "unknown", reason: "unexpected" },
  ]);
  expect(logged.entries.map((e) => e.report)).toEqual([true]);
});

it("imports once however often Import is pressed while it runs", async () => {
  const { importLink, settle } = deferred();
  render(<ImportFromUrl importLink={importLink} />);

  await typeAndImport(REPO);
  fireEvent.keyDown(field(), { key: "Enter" });
  fireEvent.click(button());

  expect(importLink).toHaveBeenCalledTimes(1);
  await act(async () => settle({ outcome: "imported", source: "github" }));
});
