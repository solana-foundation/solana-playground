import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";

// The `utils` barrel cannot load under jsdom; `Primary` needs only these
vi.mock("../../../../utils", async () => {
  const { PgCommon } = await vi.importActual<
    typeof import("../../../../utils/common")
  >("../../../../utils/common");
  const { PgView } = await vi.importActual<
    typeof import("../../../../utils/view")
  >("../../../../utils/view");
  return {
    PgCommon,
    PgView,
  };
});
vi.mock("../../../../hooks", async () => ({
  useGetAndSetStatic: (
    await vi.importActual<
      typeof import("../../../../hooks/useGetAndSetStatic")
    >("../../../../hooks/useGetAndSetStatic")
  ).useGetAndSetStatic,
}));
vi.mock("../../../../components/Loading", () => ({
  SpinnerWithBg: ({ children }: { children: unknown }) => <>{children}</>,
}));
// Draws a failed view's error, as the real boundary's fallback does
vi.mock("../../../../components/ErrorBoundary", () => ({
  default: ({ children }: { children: unknown }) =>
    children !== null && typeof children === "object" && "error" in children ? (
      <p>{String((children as { error: unknown }).error)}</p>
    ) : (
      <>{children}</>
    ),
}));

const { PgView } = await import("../../../../utils");
const { default: Primary } = await import("./Primary");

it("shows the route's view again when it mounts a second time", async () => {
  const first = render(<Primary />);
  void PgView.setMainPrimary(() => <p>route view</p>);
  expect(await screen.findByText("route view")).toBeTruthy();
  first.unmount();

  render(<Primary />);
  expect(await screen.findByText("route view")).toBeTruthy();
});

it("reports a view that fails to load, and shows the failure", async () => {
  const logs = memoryProvider();
  initLogger({ providers: [logs] });
  render(<Primary />);
  void PgView.setMainPrimary(async () => {
    throw new Error("route failed");
  });
  await waitFor(() => expect(logs.entries).toHaveLength(1));
  expect(logs.entries[0].report).toBe(true);
  expect(String(logs.entries[0].error)).toContain("route failed");
  expect(await screen.findByText(/route failed/)).toBeTruthy();
  resetLogger();
});
