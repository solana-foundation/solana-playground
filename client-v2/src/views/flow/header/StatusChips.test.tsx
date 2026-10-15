import { render, screen } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, expect, it, vi } from "vitest";

import { PgSession } from "@/features/auth";
import StatusChips from "./StatusChips";

const status = vi.hoisted(() => ({ name: "devnet", down: false }));
vi.mock("./use-cluster-status", () => ({ useClusterStatus: () => status }));
// The hooks and the command registry import the utils barrel, which reads
// generated globals that exist only in the built app
vi.mock("../../../hooks", () => ({
  useBalance: () => null,
  useConnection: () => ({ rpcEndpoint: "https://rpc.test" }),
  useOnClickOutside: () => undefined,
  useRenderOnChange: () => undefined,
  useWallet: () => null,
}));
vi.mock("../../../utils", () => ({
  PgCommand: { connect: { execute: () => undefined } },
}));
vi.mock("../settings/GearSidebar", () => ({
  SETTINGS_TRIGGER_ATTR: "data-settings-trigger",
}));

afterEach(() => {
  vi.restoreAllMocks();
  status.down = false;
});

/**
 * A theme that answers every key: the chips read deep theme keys for their
 * styles, none of which matters here, and the real theme's module needs the
 * utils barrel.
 */
const anyTheme: DefaultTheme = new Proxy(
  {},
  {
    get: (_, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : anyTheme,
  }
) as unknown as DefaultTheme;

const draw = () => {
  render(
    <ThemeProvider theme={anyTheme}>
      <StatusChips onToggleSettings={vi.fn()} settingsOpen={false} />
    </ThemeProvider>
  );
};

const clusterDot = () =>
  screen
    .getByRole("button", { name: "Change cluster, currently devnet" })
    .querySelector("[data-slot=status-dot]");

it("marks a cluster that is up with the success variant", () => {
  vi.spyOn(PgSession, "get").mockReturnValue(null);
  draw();
  expect(clusterDot()?.getAttribute("data-variant")).toBe("success");
});

it("marks a cluster that is down with the error variant", () => {
  vi.spyOn(PgSession, "get").mockReturnValue(null);
  status.down = true;
  draw();
  expect(clusterDot()?.getAttribute("data-variant")).toBe("error");
});

it("names the signed-in account on its chip", () => {
  vi.spyOn(PgSession, "get").mockReturnValue({
    id: "u1",
    login: "octo",
    name: "Octo",
    image: null,
  });
  draw();
  expect(
    screen.getByRole("button", { name: "GitHub profile: octo" })
  ).toBeTruthy();
});
