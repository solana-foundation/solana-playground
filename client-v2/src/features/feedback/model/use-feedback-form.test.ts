import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLog,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { memoryFeedbackProvider } from "./provider";
import type { FeedbackProvider } from "./provider";
import { EMPTY_DRAFT, useFeedbackForm } from "./use-feedback-form";
import type { FeedbackDraft } from "./use-feedback-form";

let events: ReturnType<typeof memoryTelemetry>;
let logs: ReturnType<typeof memoryLog>;

beforeEach(() => {
  events = memoryTelemetry();
  logs = memoryLog();
  initTelemetry({ providers: [events] });
  initLogger({ providers: [logs] });
});

afterEach(() => {
  resetTelemetry();
  resetLogger();
});

const DRAFT: FeedbackDraft = {
  message: "Deploy is slow",
  contact: " @fren ",
  rating: 4,
};

const render = (provider: FeedbackProvider, draft: FeedbackDraft = DRAFT) => {
  const onSent = vi.fn();
  const onFailedClosed = vi.fn();
  const hook = renderHook(() =>
    useFeedbackForm({ provider, cluster: "devnet", onSent, onFailedClosed })
  );
  act(() => hook.result.current.open());
  act(() => hook.result.current.edit(draft));
  return { hook, onSent, onFailedClosed };
};

/** A provider whose one send waits until the test settles it */
const heldProvider = () => {
  const held = { resolve: () => {}, reject: () => {} };
  const provider: FeedbackProvider = {
    available: true,
    send: () =>
      new Promise<void>((resolve, reject) => {
        held.resolve = resolve;
        held.reject = () => reject(new Error("held send failed"));
      }),
  };
  return { provider, held };
};

const names = () => events.events.map((e) => e.name);

describe("useFeedbackForm", () => {
  it("should track the form opening", () => {
    const { hook } = render(memoryFeedbackProvider());

    expect(hook.result.current.state.open).toBe(true);
    expect(names()).toEqual(["feedback_opened"]);
  });

  it("should send the trimmed draft, then close, clear it, say so, and track its rating", async () => {
    const provider = memoryFeedbackProvider();
    const { hook, onSent } = render(provider);

    await act(() => hook.result.current.submit());

    expect(provider.sent).toEqual([
      {
        values: { message: "Deploy is slow", contact: "@fren", rating: 4 },
        cluster: "devnet",
      },
    ]);
    expect(hook.result.current.state).toEqual({
      open: false,
      send: "idle",
      draft: EMPTY_DRAFT,
    });
    expect(onSent).toHaveBeenCalledTimes(1);
    expect([events.events[1].name, events.events[1].params]).toEqual([
      "feedback_sent",
      { rating: 4 },
    ]);
  });

  it("should send no contact for a blank handle and track no star as rating none", async () => {
    const provider = memoryFeedbackProvider();
    const { hook } = render(provider, { message: "No stars", contact: "  " });

    await act(() => hook.result.current.submit());

    expect(provider.sent[0].values).toEqual({
      message: "No stars",
      contact: undefined,
      rating: undefined,
    });
    expect(events.events[1].params).toEqual({ rating: "none" });
  });

  it("should keep an open form's draft when the send fails, and report it under feedback:form", async () => {
    const { hook, onSent, onFailedClosed } = render(
      memoryFeedbackProvider({ fail: true })
    );

    await act(() => hook.result.current.submit());

    expect(hook.result.current.state).toEqual({
      open: true,
      send: "failed",
      draft: DRAFT,
    });
    expect(onSent).not.toHaveBeenCalled();
    expect(onFailedClosed).not.toHaveBeenCalled();
    expect(names()).toEqual(["feedback_opened", "feedback_failed"]);
    expect(logs.entries.map((e) => [e.ns, e.level, e.report])).toEqual([
      ["feedback:form", "error", true],
    ]);
  });

  it("should close while sending, and keep the draft and say so when that send fails", async () => {
    const { provider, held } = heldProvider();
    const { hook, onFailedClosed } = render(provider);
    let sending: Promise<void> = Promise.resolve();
    act(() => {
      sending = hook.result.current.submit();
    });

    act(() => hook.result.current.close());
    expect(hook.result.current.state.open).toBe(false);
    expect(hook.result.current.state.send).toBe("sending");
    await act(async () => {
      held.reject();
      await sending;
    });

    expect(hook.result.current.state).toEqual({
      open: false,
      send: "failed",
      draft: DRAFT,
    });
    expect(onFailedClosed).toHaveBeenCalledTimes(1);
  });

  it("should clear the draft of a form closed mid-send once that send succeeds", async () => {
    const { provider, held } = heldProvider();
    const { hook, onSent } = render(provider);
    let sending: Promise<void> = Promise.resolve();
    act(() => {
      sending = hook.result.current.submit();
    });
    act(() => hook.result.current.close());

    await act(async () => {
      held.resolve();
      await sending;
    });

    expect(hook.result.current.state.draft).toEqual(EMPTY_DRAFT);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("should keep the draft across closing and opening the form", () => {
    const { hook } = render(memoryFeedbackProvider());

    act(() => hook.result.current.close());
    act(() => hook.result.current.open());

    expect(hook.result.current.state.draft).toEqual(DRAFT);
  });

  it("should send again from a failed form", async () => {
    let fail = true;
    const provider: FeedbackProvider = {
      available: true,
      send: () => (fail ? Promise.reject(new Error()) : Promise.resolve()),
    };
    const { hook, onSent } = render(provider);
    await act(() => hook.result.current.submit());

    fail = false;
    await act(() => hook.result.current.submit());

    expect(hook.result.current.state.send).toBe("idle");
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("should put neither the message nor the contact in any event", async () => {
    const failed = render(memoryFeedbackProvider({ fail: true })).hook;
    await act(() => failed.result.current.submit());
    const sent = render(memoryFeedbackProvider()).hook;
    await act(() => sent.result.current.submit());

    const serialised = JSON.stringify(events.events);
    expect(serialised).not.toContain("Deploy is slow");
    expect(serialised).not.toContain("@fren");
  });
});
