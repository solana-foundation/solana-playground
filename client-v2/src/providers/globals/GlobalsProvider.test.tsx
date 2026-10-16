import type { Mock } from "vitest";
// `initAll` is mocked so the test can count calls; `useAsyncEffect` is the
// real hook, so the double mount runs the real effect twice.
vi.mock("../../utils", () => ({
  initAll: vi.fn(),
}));

vi.mock("../../globals", () => ({ GLOBALS: [] }));

vi.mock("../../components/Loading/App", () => ({
  AppLoading: () => <div data-testid="app-loading" />,
}));

vi.mock("../../hooks", async () => ({
  useAsyncEffect: (
    await vi.importActual<typeof import("../../hooks/useAsyncEffect")>(
      "../../hooks/useAsyncEffect"
    )
  ).useAsyncEffect,
}));

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Tells React this environment runs `act`, as React 18+ expects
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { GlobalsProvider } from "./GlobalsProvider";
import { initAll } from "../../utils";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("GlobalsProvider", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // The factory's `initAll` is a bare `vi.fn()`, which `mockReset` (see
    // `vitest.config.ts`) returns to before each test, so its answer is set
    // here
    (initAll as Mock).mockResolvedValue({ dispose: vi.fn() });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("initializes the globals once under strict mode's double mount", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <GlobalsProvider>
            <div data-testid="app" />
          </GlobalsProvider>
        </StrictMode>
      );
      await flush();
    });

    expect(initAll).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="app"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="app-loading"]')).toBeNull();
  });
});
