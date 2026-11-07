// A stage's code fails to load (offline, or a release replaced the chunk): the
// stage says so in its own panel and the rest of the app stays up.
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { Component, StrictMode, Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initLogger, resetLogger } from "@/shared/lib/logger";
import { memoryProvider } from "@/shared/lib/logger/providers/memory";

import { BaseStageLoadFailed, lazyStage } from "./lazy-stage";

type Module = { default: ComponentType };

const Loaded = () => <p>stage content</p>;
/** What webpack rejects with when a chunk does not arrive */
const chunkError = () =>
  Object.assign(new Error("Loading chunk 7 failed"), {
    name: "ChunkLoadError",
  });
const failed = () => Promise.reject(chunkError());
const loaded = () => Promise.resolve<Module>({ default: Loaded });

/** Stands in for the app's own boundary, the screen this must not reach */
class AppBoundary extends Component<
  { children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {};
  static getDerivedStateFromError = (error: Error) => ({ error });
  render() {
    return this.state.error ? (
      <p>app crashed: {this.state.error.message}</p>
    ) : (
      this.props.children
    );
  }
}

const show = async (Stage: ComponentType) => {
  const view = render(
    // As the app mounts: it replays every mount, which is no one leaving a stage
    <StrictMode>
      <AppBoundary>
        <Suspense fallback={<p>loading</p>}>
          <Stage />
        </Suspense>
      </AppBoundary>
    </StrictMode>
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
};

const goOnline = () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
};

describe("lazyStage", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the stage when its code loads", async () => {
    await show(lazyStage(loaded, "deploy"));
    expect(await screen.findByText("stage content")).toBeTruthy();
  });

  it("says offline that the stage needs a connection, without crashing the app", async () => {
    await show(lazyStage(failed, "deploy"));
    expect(await screen.findByText("Deploy needs a connection")).toBeTruthy();
    expect(screen.queryByText(/app crashed/)).toBeNull();
  });

  it("does not load again by itself while it stays failed", async () => {
    const load = vi.fn(failed);
    await show(lazyStage(load, "deploy"));
    await screen.findByText("Deploy needs a connection");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("says it did not load when the browser reports a network", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await show(lazyStage(failed, "deploy"));
    expect(await screen.findByText("Deploy couldn't load")).toBeTruthy();
  });

  describe("reporting", () => {
    let logged: ReturnType<typeof memoryProvider>;
    beforeEach(() => {
      logged = memoryProvider();
      initLogger({ providers: [logged] });
    });
    afterEach(() => resetLogger());

    it("logs an offline failure without reporting it", async () => {
      await show(lazyStage(failed, "deploy"));
      await screen.findByText("Deploy needs a connection");
      expect(logged.entries.map((entry) => entry.report)).toEqual([false]);
    });

    it("reports a failure with a network, once however often it is retried", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      await show(lazyStage(failed, "interact"));
      fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
      await screen.findByText(/Reload the page/);
      expect(logged.entries.filter((entry) => entry.report)).toHaveLength(1);
      expect(logged.entries[0].context).toEqual({ stage: "interact" });
    });

    it("does not report the retry a returning network starts, which often fails", async () => {
      await show(lazyStage(failed, "deploy"));
      await screen.findByText("Deploy needs a connection");
      goOnline();
      await act(async () => {
        await Promise.resolve();
      });
      await screen.findByText("Deploy couldn't load");
      expect(logged.entries.filter((entry) => entry.report)).toEqual([]);
    });
  });

  it("loads the stage on Try again", async () => {
    const load = vi.fn<() => Promise<Module>>(failed);
    await show(lazyStage(load, "deploy"));
    load.mockImplementation(loaded);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("stage content")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loads the stage by itself when the network comes back", async () => {
    const load = vi.fn<() => Promise<Module>>(failed);
    await show(lazyStage(load, "deploy"));
    await screen.findByText("Deploy needs a connection");
    load.mockImplementation(loaded);
    goOnline();
    expect(await screen.findByText("stage content")).toBeTruthy();
  });

  it("tries again when the stage is opened again after a failure", async () => {
    const load = vi.fn<() => Promise<Module>>(failed);
    const Stage = lazyStage(load, "deploy");
    const first = await show(Stage);
    await screen.findByText("Deploy needs a connection");
    first.unmount();

    load.mockImplementation(loaded);
    await show(Stage);
    expect(await screen.findByText("stage content")).toBeTruthy();
  });

  it("leaves a chunk that arrives and throws to the app's boundary", async () => {
    await show(
      lazyStage(() => Promise.reject(new Error("top level")), "deploy")
    );
    expect(await screen.findByText(/app crashed: top level/)).toBeTruthy();
  });

  it("shows the failure again when Try again fails offline", async () => {
    const load = vi.fn(failed);
    await show(lazyStage(load, "deploy"));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(await screen.findByText("Deploy needs a connection")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("makes one load of a retry that takes time", async () => {
    let arrive: (module: Module) => void = () => undefined;
    const load = vi.fn<() => Promise<Module>>(failed);
    await show(lazyStage(load, "deploy"));
    load.mockImplementation(
      () =>
        new Promise((resolve) => {
          arrive = resolve;
        })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByText("loading");
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => arrive({ default: Loaded }));
    expect(await screen.findByText("stage content")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ignores an online event when the failure came with a network", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const load = vi.fn(failed);
    await show(lazyStage(load, "deploy"));
    await screen.findByText("Deploy couldn't load");
    goOnline();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads by itself when the stage is opened online after failing offline unseen", async () => {
    // Left before the import rejected: nothing on screen ever showed the failure
    let fail: (error: Error) => void = () => undefined;
    const load = vi.fn<() => Promise<Module>>(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        })
    );
    const Stage = lazyStage(load, "deploy");
    const left = await show(Stage);
    left.unmount();
    await act(async () => fail(chunkError()));

    load.mockImplementation(loaded);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await show(Stage);
    expect(await screen.findByText("stage content")).toBeTruthy();
  });

  it("starts over on the words for a reload when the stage is opened again", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const Stage = lazyStage(failed, "deploy");
    const first = await show(Stage);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByText(/Reload the page/);
    first.unmount();

    await show(Stage);
    expect(await screen.findByText(/Check your connection/)).toBeTruthy();
  });

  it("points to a reload when a retry takes time to fail", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const load = vi.fn<() => Promise<Module>>(failed);
    await show(lazyStage(load, "deploy"));
    await screen.findByText(/Check your connection/);
    load.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(chunkError()), 30);
        })
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Reload the page/)).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the first words after a returning network's retry fails", async () => {
    await show(lazyStage(failed, "deploy"));
    await screen.findByText("Deploy needs a connection");
    goOnline();
    await screen.findByText("Deploy couldn't load");
    expect(screen.getByText(/Check your connection/)).toBeTruthy();
  });

  it("leaves an error thrown while the stage renders to the app's boundary", async () => {
    const Broken = (): never => {
      throw new Error("render broke");
    };
    await show(lazyStage(() => Promise.resolve({ default: Broken }), "deploy"));
    expect(await screen.findByText(/app crashed: render broke/)).toBeTruthy();
  });

  it("points to a reload once a retry failed with a network, as a new release removes the old chunk", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await show(lazyStage(failed, "deploy"));
    expect(
      await screen.findByText(
        "Check your connection and try again. Your code is unchanged."
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText(
        "Reload the page to get the latest version. Your code is unchanged."
      )
    ).toBeTruthy();
  });
});

describe("BaseStageLoadFailed", () => {
  const failure = {
    stage: "deploy" as const,
    hasRetried: false,
    onRetry: () => undefined,
  };

  it("offers Reload page with a network and reloads", () => {
    const onReload = vi.fn();
    render(<BaseStageLoadFailed {...failure} isOnline onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("keeps Try again offline and offers no reload, which would lose the app", () => {
    render(<BaseStageLoadFailed {...failure} isOnline={false} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reload page" })).toBeNull();
    expect(
      screen.getByText("It hasn't loaded yet. Your code is unchanged.")
    ).toBeTruthy();
  });
});
