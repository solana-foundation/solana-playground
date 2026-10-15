// The sidebar Deploy button: a second press while a deploy runs pauses it.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  deployState: "ready" as "ready" | "loading" | "paused" | "cancelled",
  execute: vi.fn(),
  report: vi.fn(),
}));

// The real barrels pull in the whole playground; the button reads only these
vi.mock("../../../../utils", () => ({
  PgCommand: { deploy: { execute: state.execute } },
  PgGlobal: {
    onDidChangeBuildLoading: "buildLoading",
    onDidChangeDeployState: "deployState",
  },
}));
vi.mock("../../../../components/Icons", () => ({
  Pause: () => null,
  Rocket: () => null,
  Triangle: () => null,
}));
vi.mock("../../../../hooks", () => ({
  useRenderOnChange: (event: string) =>
    event === "deployState" ? state.deployState : false,
  useProgramInfo: () => ({
    onChain: {
      deployed: true,
      upgradable: true,
      authority: { equals: () => true },
    },
    kp: {},
    uuid: "u",
  }),
  useWallet: () => ({ publicKey: "authority" }),
}));

vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: state.report,
}));

import Deploy from "./Deploy";

// The wrapper reads one theme key for its border
const theme = {
  colors: { default: { border: "gray" } },
} as unknown as DefaultTheme;

afterEach(() => {
  state.deployState = "ready";
  state.execute.mockReset();
  state.report.mockReset();
});

describe("sidebar Deploy", () => {
  it("pauses a running deploy on a second press", async () => {
    state.execute.mockReturnValue(new Promise(() => undefined));
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <Deploy />
      </ThemeProvider>
    );

    await act(async () => fireEvent.click(screen.getByRole("button")));
    state.deployState = "loading";
    rerender(
      <ThemeProvider theme={theme}>
        <Deploy />
      </ThemeProvider>
    );
    const button = screen.getByRole("button", { name: /upgrading/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    await act(async () => fireEvent.click(button));
    expect(state.execute).toHaveBeenCalledTimes(2);
  });

  it("reports a deploy that fails", async () => {
    const failure = new Error("insufficient balance");
    state.execute.mockRejectedValue(failure);
    render(
      <ThemeProvider theme={theme}>
        <Deploy />
      </ThemeProvider>
    );

    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(state.report).toHaveBeenCalledWith(failure);
  });
});
