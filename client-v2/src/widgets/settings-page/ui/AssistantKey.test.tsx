import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "@/shared/lib/telemetry";

import { storedValues } from "../../../test-utils/stored-values";
import {
  KEY_NOT_FORGOTTEN,
  PgAssistant,
} from "../../../views/sidebar/assistant/store";
import AssistantKey from "./AssistantKey";

const KEY = "sk-test-settings-0123456789";

let events: ReturnType<typeof memoryTelemetry>;

beforeEach(() => {
  events = memoryTelemetry();
  initTelemetry({ providers: [events] });
  localStorage.clear();
  sessionStorage.clear();
  PgAssistant.disconnect();
});

afterEach(() => {
  act(() => PgAssistant.disconnect());
  resetTelemetry();
});

const button = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Delete my key" });

it("deletes the user's key, disconnects and says so", async () => {
  PgAssistant.connect({ id: "anthropic", apiKey: KEY });
  render(<AssistantKey phone={false} />);
  expect(button().disabled).toBe(false);

  await userEvent.click(button());

  expect(PgAssistant.connection).toBeNull();
  expect(button().disabled).toBe(true);
  expect(screen.getByText(/No key entered/)).toBeTruthy();
  expect(JSON.stringify(storedValues(sessionStorage))).not.toContain(KEY);
  expect(JSON.stringify(storedValues(localStorage))).not.toContain(KEY);
  expect(events.events.map((e) => [e.name, e.params])).toEqual([
    ["settings_key_deleted", {}],
  ]);
});

it("has nothing to delete for the keyless default", () => {
  PgAssistant.connect({ id: "default", apiKey: "" });
  render(<AssistantKey phone={false} />);
  expect(button().disabled).toBe(true);
});

it("has nothing to delete with nothing connected", () => {
  render(<AssistantKey phone={false} />);
  expect(button().disabled).toBe(true);
});

it("waits while a turn is using the key", () => {
  PgAssistant.connect({ id: "anthropic", apiKey: KEY });
  render(<AssistantKey phone={false} />);

  act(() => PgAssistant.setStatus("running"));
  expect(button().disabled).toBe(true);
  expect(screen.getByText(/In use by the reply/)).toBeTruthy();

  act(() => PgAssistant.setStatus("idle"));
  expect(button().disabled).toBe(false);
});

it("drops a key an older build kept, as soon as the row shows", () => {
  sessionStorage.setItem(
    "assistant.connection",
    JSON.stringify({ id: "anthropic", apiKey: KEY })
  );
  render(<AssistantKey phone={false} />);
  expect(sessionStorage.getItem("assistant.connection")).toBeNull();
  expect(screen.getByText(/No key entered/)).toBeTruthy();
});

it("says so when the key an older build kept cannot be removed", async () => {
  PgAssistant.connect({ id: "anthropic", apiKey: KEY });
  render(<AssistantKey phone={false} />);
  sessionStorage.setItem(
    "assistant.connection",
    JSON.stringify({ id: "anthropic", apiKey: KEY })
  );
  // Neither the removal nor its blanking fallback goes through
  for (const method of ["removeItem", "setItem"] as const) {
    const original = Storage.prototype[method] as (...args: string[]) => void;
    vi.spyOn(Storage.prototype, method).mockImplementation(function (
      this: Storage,
      ...args: string[]
    ) {
      if (this === sessionStorage) throw new Error("blocked");
      original.apply(this, args);
    } as never);
  }

  await userEvent.click(button());
  vi.restoreAllMocks();

  expect(screen.getByText(KEY_NOT_FORGOTTEN)).toBeTruthy();
  expect(PgAssistant.connection).toBeNull();
});

it("waits while a send is still starting, as the head does", () => {
  PgAssistant.connect({ id: "anthropic", apiKey: KEY });
  render(<AssistantKey phone={false} />);

  act(() => PgAssistant.markTurnBusy(true));
  expect(button().disabled).toBe(true);

  act(() => PgAssistant.markTurnBusy(false));
  expect(button().disabled).toBe(false);
});
