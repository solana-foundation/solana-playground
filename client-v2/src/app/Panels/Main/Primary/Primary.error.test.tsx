import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";

// The `utils` barrel cannot load under jsdom; `Primary` needs only these.
// The boundary is the real one: what it keeps between views is under test.
vi.mock("../../../../utils", async () => {
  const { PgCommon } = await vi.importActual<
    typeof import("../../../../utils/common")
  >("../../../../utils/common");
  const { PgView } = await vi.importActual<
    typeof import("../../../../utils/view")
  >("../../../../utils/view");
  return { PgCommon, PgView };
});
vi.mock("../../../../hooks", async () => ({
  // The boundary's Refresh path runs a failed view's loader again with it
  useAsyncEffect: (
    await vi.importActual<typeof import("../../../../hooks/useAsyncEffect")>(
      "../../../../hooks/useAsyncEffect"
    )
  ).useAsyncEffect,
  useGetAndSetStatic: (
    await vi.importActual<
      typeof import("../../../../hooks/useGetAndSetStatic")
    >("../../../../hooks/useGetAndSetStatic")
  ).useGetAndSetStatic,
}));
vi.mock("../../../../components/Loading", () => ({
  SpinnerWithBg: ({ children }: { children: unknown }) => <>{children}</>,
}));
vi.mock("../../../../components/ErrorBoundary/Fallback", () => ({
  default: ({ error }: { error: Error }) => <p>{error.message}</p>,
}));
vi.mock("../../../../components/Icons", () => ({ Refresh: () => undefined }));

const { PgView } = await import("../../../../utils");
const { default: Primary } = await import("./Primary");

beforeEach(() => initLogger({ providers: [memoryProvider()] }));
afterEach(() => resetLogger());

it("drops a failed route's error when the next route brings its view", async () => {
  render(<Primary />);
  void PgView.setMainPrimary(async () => {
    throw new Error("Seahorse example is gone");
  });
  expect(await screen.findByText("Seahorse example is gone")).toBeTruthy();

  void PgView.setMainPrimary(async () => <p>Hello Solana</p>);

  expect(await screen.findByText("Hello Solana")).toBeTruthy();
  expect(screen.queryByText("Seahorse example is gone")).toBeNull();
});

it("keeps a newer view over an older one that fails after it", async () => {
  render(<Primary />);
  let fail: ((e: Error) => void) | undefined;
  void PgView.setMainPrimary(
    async () =>
      new Promise<ReactElement>((_, reject) => {
        fail = reject;
      })
  );
  // The older view is loading in `Primary`, not still waiting for a mount,
  // where `setMainPrimary` would drop it itself
  await waitFor(() => expect(fail).toBeDefined());
  void PgView.setMainPrimary(async () => <p>Overtaking program</p>);
  expect(await screen.findByText("Overtaking program")).toBeTruthy();

  fail?.(new Error("Seahorse example is gone"));
  // The failure lands once `PgCommon.transition`'s 300 ms floor is past
  await new Promise((resolve) => setTimeout(resolve, 500));

  expect(screen.getByText("Overtaking program")).toBeTruthy();
  expect(screen.queryByText("Seahorse example is gone")).toBeNull();
});

it("drops a failed route's error when the next route brings a plain view", async () => {
  render(<Primary />);
  void PgView.setMainPrimary(async () => {
    throw new Error("Seahorse example is gone");
  });
  expect(await screen.findByText("Seahorse example is gone")).toBeTruthy();

  void PgView.setMainPrimary(() => <p>Home</p>);

  expect(await screen.findByText("Home")).toBeTruthy();
  expect(screen.queryByText("Seahorse example is gone")).toBeNull();
});

it("keeps a newer view over an older one that loads after it", async () => {
  render(<Primary />);
  let load: ((el: ReactElement) => void) | undefined;
  void PgView.setMainPrimary(
    async () =>
      new Promise<ReactElement>((resolve) => {
        load = resolve;
      })
  );
  await waitFor(() => expect(load).toBeDefined());
  void PgView.setMainPrimary(async () => <p>Newer program</p>);
  expect(await screen.findByText("Newer program")).toBeTruthy();

  load?.(<p>Older program</p>);
  // The older view lands once `PgCommon.transition`'s 300 ms floor is past
  await new Promise((resolve) => setTimeout(resolve, 500));

  expect(screen.getByText("Newer program")).toBeTruthy();
  expect(screen.queryByText("Older program")).toBeNull();
});
