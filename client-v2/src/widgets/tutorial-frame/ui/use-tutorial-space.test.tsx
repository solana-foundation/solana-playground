import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onDocRequest, requestCode, requestDoc } from "@/entities/tutorial";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

// The entry pulls in the app's settings, which need the booted app; the
// requests live in one module, rebuilt here as the entry
vi.mock("@/entities/tutorial", () => import("@/entities/tutorial/model/docs"));

import type { UseTutorialSpaceOptions } from "./use-tutorial-space";
import { useTutorialSpace } from "./use-tutorial-space";

/** Hello Anchor on the phone, with what a test changes named */
const options = (
  over: Partial<UseTutorialSpaceOptions>
): UseTutorialSpaceOptions => ({
  name: over.name ?? "Hello Anchor",
  wrote: over.wrote ?? 0,
  finished: over.finished ?? false,
  loaded: over.loaded ?? true,
  phone: over.phone ?? true,
});

const draw = (initial: UseTutorialSpaceOptions) =>
  renderHook((props: UseTutorialSpaceOptions) => useTutorialSpace(props), {
    initialProps: initial,
  });

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  resetTelemetry();
});

describe("useTutorialSpace", () => {
  it("starts on Chat", () => {
    const { result } = draw(options({}));
    expect(result.current.space).toBe("chat");
    expect(result.current.dot).toBe(false);
  });

  it("switches to Code when the lesson asks for the code", () => {
    const { result } = draw(options({}));
    act(() => requestCode());
    expect(result.current.space).toBe("code");
  });

  it("switches to Code once the workspace shows a doc page", () => {
    const { result } = draw(options({}));
    const stop = onDocRequest(() => true);
    let shown: boolean | undefined;
    act(() => {
      shown = requestDoc("idl.md");
    });
    stop();
    expect(shown).toBe(true);
    expect(result.current.space).toBe("code");
  });

  it("stays on Chat when no workspace has the doc page", () => {
    const { result } = draw(options({}));
    let shown: boolean | undefined;
    act(() => {
      shown = requestDoc("missing.md");
    });
    expect(shown).toBe(false);
    expect(result.current.space).toBe("chat");
  });

  it("marks Code when the assistant writes while Chat shows, and clears it on Code", () => {
    const { result, rerender } = draw(options({ wrote: 1 }));
    expect(result.current.dot).toBe(false);
    rerender(options({ wrote: 2 }));
    expect(result.current.dot).toBe(true);
    act(() => result.current.setSpace("code", "toggle"));
    expect(result.current.dot).toBe(false);
  });

  it("does not mark Code for writes seen in Code", () => {
    const { result, rerender } = draw(options({ wrote: 1 }));
    act(() => result.current.setSpace("code", "toggle"));
    rerender(options({ wrote: 2 }));
    act(() => result.current.setSpace("chat", "toggle"));
    expect(result.current.dot).toBe(false);
  });

  it("counts the writes a reload restores as seen", () => {
    const { result, rerender } = draw(options({ wrote: 0, loaded: false }));
    rerender(options({ wrote: 3 }));
    expect(result.current.dot).toBe(false);
    rerender(options({ wrote: 4 }));
    expect(result.current.dot).toBe(true);
  });

  it("hides the dot once the tutorial is finished", () => {
    const { result, rerender } = draw(options({ wrote: 1 }));
    rerender(options({ wrote: 2 }));
    expect(result.current.dot).toBe(true);
    rerender(options({ wrote: 2, finished: true }));
    expect(result.current.dot).toBe(false);
  });

  it("starts each tutorial entered on Chat", () => {
    const { result, rerender } = draw(options({ wrote: 1 }));
    rerender(options({ wrote: 2 }));
    act(() => result.current.setSpace("code", "swipe"));
    rerender(options({ name: "Counter", wrote: 0 }));
    expect(result.current.space).toBe("chat");
    expect(result.current.dot).toBe(false);
  });

  it("listens to no request off the phone", () => {
    const { result } = draw(options({ phone: false }));
    let shown: boolean | undefined;
    act(() => {
      requestCode();
      shown = requestDoc("idl.md");
    });
    expect(result.current.space).toBe("chat");
    expect(shown).toBe(false);
  });

  it("reports the space and what switched it", () => {
    const { result } = draw(options({}));
    act(() => result.current.setSpace("code", "swipe"));
    act(() => result.current.setSpace("code", "toggle"));
    act(() => requestCode());
    expect(
      sent.events
        .filter((e) => e.name === "tutorial_frame_space_changed")
        .map((e) => e.params)
    ).toEqual([{ space: "code", via: "swipe" }]);
  });

  it("reports a switch by Show and by a doc page", () => {
    const { result } = draw(options({}));
    act(() => requestCode());
    act(() => result.current.setSpace("chat", "toggle"));
    const stop = onDocRequest(() => true);
    act(() => {
      requestDoc("idl.md");
    });
    stop();
    expect(
      sent.events
        .filter((e) => e.name === "tutorial_frame_space_changed")
        .map((e) => e.params)
    ).toEqual([
      { space: "code", via: "show" },
      { space: "chat", via: "toggle" },
      { space: "code", via: "doc" },
    ]);
  });

  it("marks Code for the first write after Start over", () => {
    const { result, rerender } = draw(options({ wrote: 3 }));
    rerender(options({ wrote: 0 }));
    expect(result.current.dot).toBe(false);
    rerender(options({ wrote: 1 }));
    expect(result.current.dot).toBe(true);
  });
});
