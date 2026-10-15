// The design system's AsyncButton and CopyButton as installed: how each waits
// for its work, what it says meanwhile, and that a failure goes to onError
// instead of being lost.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AsyncButton } from "@/shared/ui/async-button";
import { CopyButton } from "@/shared/ui/copy-button";
import { TooltipProvider } from "@/shared/ui/tooltip";

// The tooltip positions itself with a `ResizeObserver`, which jsdom lacks.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
  try {
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

describe("AsyncButton", () => {
  it("is disabled and busy until its promise settles", async () => {
    let resolve!: () => void;
    const work = new Promise<void>((r) => (resolve = r));
    render(<AsyncButton onClick={() => work}>Build</AsyncButton>);
    const button = screen.getByRole("button", { name: /build/i });

    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");

    await act(async () => resolve());
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("says its loadingText while it waits", async () => {
    let resolve!: () => void;
    const work = new Promise<void>((r) => (resolve = r));
    render(
      <AsyncButton onClick={() => work} loadingText="Sending...">
        Send
      </AsyncButton>
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("button").textContent).toBe("Sending...");

    await act(async () => resolve());
    expect(screen.getByRole("button").textContent).toBe("Send");
  });

  it("keeps its own wait when loading is false", async () => {
    let resolve!: () => void;
    const work = new Promise<void>((r) => (resolve = r));
    render(
      <AsyncButton loading={false} onClick={() => work}>
        Build
      </AsyncButton>
    );
    const button = screen.getByRole("button", { name: /build/i });

    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");

    await act(async () => resolve());
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("is disabled and busy while loading, before any click", () => {
    render(<AsyncButton loading>Build</AsyncButton>);
    const button = screen.getByRole("button", { name: /build/i });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("cannot have its busy state overridden by a caller", async () => {
    let resolve!: () => void;
    const work = new Promise<void>((r) => (resolve = r));
    render(
      <AsyncButton aria-busy={false} data-loading={false} onClick={() => work}>
        Build
      </AsyncButton>
    );
    const button = screen.getByRole("button", { name: /build/i });

    fireEvent.click(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("data-loading")).toBe("true");

    await act(async () => resolve());
  });

  it("hands a rejection to onError and is enabled again", async () => {
    const failure = new Error("build server down");
    const onError = vi.fn();
    render(
      <AsyncButton onClick={() => Promise.reject(failure)} onError={onError}>
        Build
      </AsyncButton>
    );
    const button = screen.getByRole("button", { name: /build/i });

    await act(async () => fireEvent.click(button));
    expect(onError).toHaveBeenCalledWith(failure);
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("hands a synchronous throw to onError", async () => {
    const failure = new Error("no workspace");
    const onError = vi.fn();
    render(
      <AsyncButton
        onClick={() => {
          throw failure;
        }}
        onError={onError}
      >
        Build
      </AsyncButton>
    );

    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(onError).toHaveBeenCalledWith(failure);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it("waits for a thenable that is not a native Promise", async () => {
    let resolve!: () => void;
    const thenable = {
      then: (done: () => void) => {
        resolve = done;
      },
    };
    render(<AsyncButton onClick={() => thenable}>Build</AsyncButton>);
    const button = screen.getByRole("button", { name: /build/i });

    // `await` calls `then` a microtask later, so let it run
    await act(async () => fireEvent.click(button));
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await act(async () => resolve());
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("CopyButton", () => {
  const renderCopy = (onError = vi.fn()) => {
    render(
      <TooltipProvider>
        <CopyButton value="https://beta.solpg.io/abc" onError={onError} />
      </TooltipProvider>
    );
    return { onError, button: screen.getByRole("button", { name: "Copy" }) };
  };

  it("writes its value and says Copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { button } = renderCopy();

    await act(async () => fireEvent.click(button));
    expect(writeText).toHaveBeenCalledWith("https://beta.solpg.io/abc");
    expect(button.getAttribute("aria-label")).toBe("Copied");
  });

  it("does not say Copied when the clipboard refuses, and reports it", async () => {
    const refusal = new DOMException("denied", "NotAllowedError");
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(refusal) },
    });
    const { button, onError } = renderCopy();

    await act(async () => fireEvent.click(button));
    expect(onError).toHaveBeenCalledWith(refusal);
    expect(button.getAttribute("aria-label")).toBe("Copy");
  });

  it("reports a browser with no clipboard", async () => {
    vi.stubGlobal("navigator", {});
    const { button, onError } = renderCopy();

    await act(async () => fireEvent.click(button));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-label")).toBe("Copy");
  });

  it("keeps Copied for the full window after a second press", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const { button } = renderCopy();

    await act(async () => fireEvent.click(button));
    await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => fireEvent.click(button));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(button.getAttribute("aria-label")).toBe("Copied");
    await act(async () => vi.advanceTimersByTime(500));
    expect(button.getAttribute("aria-label")).toBe("Copy");
  });
});
