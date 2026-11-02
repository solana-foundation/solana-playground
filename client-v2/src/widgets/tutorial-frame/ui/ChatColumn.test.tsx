import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import ChatColumn from "./ChatColumn";

const handle = () =>
  screen.getByRole("separator", { name: "Resize the chat column" });
const width = () => Number(handle().getAttribute("aria-valuenow"));

/** Narrows or widens the window, as a resize does */
const windowAt = (w: number) =>
  act(() => {
    vi.stubGlobal("innerWidth", w);
    window.dispatchEvent(new Event("resize"));
  });

const draw = () =>
  render(
    <ChatColumn name="Hello Anchor" onBack={vi.fn()}>
      <p>feed</p>
    </ChatColumn>
  );

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("innerWidth", 1440);
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetTelemetry();
});

const resized = () =>
  sent.events
    .filter((e) => e.name === "tutorial_frame_chat_resized")
    .map((e) => e.params);

describe("ChatColumn", () => {
  it("follows the window until a width is picked", () => {
    draw();
    expect(width()).toBe(421);
    windowAt(1152);
    expect(width()).toBe(360);
  });

  it("keeps a picked width across a remount and measures it", () => {
    const { unmount } = draw();
    fireEvent.keyDown(handle(), { key: "End" });
    expect(width()).toBe(560);
    expect(resized()).toEqual([{ width: 560, via: "key" }]);
    unmount();
    draw();
    expect(width()).toBe(560);
  });

  it("holds a picked width to the window and gives it back when it widens", () => {
    draw();
    fireEvent.keyDown(handle(), { key: "End" });
    windowAt(1024);
    // 1024 − 52 rail − 560 workspace leaves 412
    expect(width()).toBe(412);
    windowAt(1440);
    expect(width()).toBe(560);
  });

  it("hands the width back to the window on a double click", () => {
    draw();
    fireEvent.keyDown(handle(), { key: "End" });
    fireEvent.doubleClick(handle());
    expect(width()).toBe(421);
    expect(localStorage.getItem("tutorial.chatWidth")).toBeNull();
    expect(resized()).toEqual([
      { width: 560, via: "key" },
      { width: 421, via: "reset" },
    ]);
  });

  it("measures nothing for a key at the end it is already at", () => {
    draw();
    fireEvent.keyDown(handle(), { key: "End" });
    fireEvent.keyDown(handle(), { key: "End" });
    expect(resized()).toHaveLength(1);
  });
});
