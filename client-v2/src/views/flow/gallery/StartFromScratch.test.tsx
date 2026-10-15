// The gallery's Start button: one project per press, and usable again after
// a failure that has nothing to do with the name.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDefaultFiles: vi.fn(),
  createWorkspace: vi.fn(),
  setModal: vi.fn(),
}));

// The `@/utils` barrel needs a booted app; the row reads only these
vi.mock("../../../utils", () => ({
  PgExplorer: {
    isWorkspaceNameValid: (name: string) => name.length > 0,
    createWorkspace: mocks.createWorkspace,
  },
  PgFramework: {
    all: [{ name: "Anchor", icon: "", circleImage: false }],
    get: () => ({
      getDefaultFiles: mocks.getDefaultFiles,
      defaultOpenFile: "src/lib.rs",
    }),
  },
  PgView: { setModal: mocks.setModal },
  PgTheme: { alpha: () => "inherit" },
}));
vi.mock("../../../components/Img", () => ({ default: () => null }));
// `Input` reads the theme through the same barrel; this keeps its contract:
// the error is shown above the field
vi.mock("../../../components/Input", () => ({
  default: ({
    error,
    setError: _setError,
    ...props
  }: React.ComponentProps<"input"> & {
    error?: string;
    setError?: unknown;
  }) => (
    <>
      {error && <p role="alert">{error}</p>}
      <input {...props} />
    </>
  ),
}));

import StartFromScratch from "./StartFromScratch";

/** A theme that answers every key; the styles do not matter here */
const anyTheme: DefaultTheme = new Proxy(
  {},
  {
    get: (_, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : anyTheme,
  }
) as unknown as DefaultTheme;

// The framework picker measures its indicator with a `ResizeObserver`, which
// jsdom lacks
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  mocks.createWorkspace.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const draw = () =>
  render(
    <ThemeProvider theme={anyTheme}>
      <StartFromScratch />
    </ThemeProvider>
  );

const start = () => screen.getByRole("button", { name: /Start/ });

it("makes one project for a double press and closes the gallery", async () => {
  let release!: () => void;
  mocks.getDefaultFiles.mockReturnValue(
    new Promise((resolve) => (release = () => resolve({ files: [] })))
  );
  draw();

  fireEvent.click(start());
  fireEvent.click(start());

  expect(start()).toHaveProperty("disabled", true);
  expect(start().getAttribute("aria-busy")).toBe("true");

  await act(async () => release());

  expect(mocks.getDefaultFiles).toHaveBeenCalledTimes(1);
  expect(mocks.createWorkspace).toHaveBeenCalledTimes(1);
  expect(mocks.setModal).toHaveBeenCalledWith(null);
});

it("shows a failure that is not about the name and accepts a retry", async () => {
  mocks.getDefaultFiles.mockRejectedValue(new Error("offline"));
  draw();

  await act(async () => fireEvent.click(start()));

  expect(screen.getByRole("alert").textContent).toBe("offline");
  expect(start().getAttribute("aria-busy")).toBeNull();
  expect(start()).toHaveProperty("disabled", false);
});
