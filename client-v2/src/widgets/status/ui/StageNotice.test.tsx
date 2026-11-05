import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { PgView } from "@/utils/view";

import type { NetworkInput } from "../model/indicators";

// The `@/utils` barrel reaches globals only a booted app has; the notice uses
// the connection's re-check alone
const connection = vi.hoisted(() => ({
  recheck: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("@/utils", () => ({ PgConnection: connection }));

const net = vi.hoisted(() => ({
  input: { name: "devnet", isConnected: true, slotStalled: false } as
    | NetworkInput
    | undefined,
}));
vi.mock("../model/use-status", () => ({ useNetworkInput: () => net.input }));

import BaseStageNotice from "./BaseStageNotice";
import { StageNotice } from "./StageNotice";

const UP: NetworkInput = {
  name: "devnet",
  isConnected: true,
  slotStalled: false,
};
const DOWN: NetworkInput = {
  name: "devnet",
  isConnected: false,
  slotStalled: null,
};
const OFFLINE =
  "You're offline. Editing still works. Build, Deploy and the assistant need a connection.";
const CLUSTER = "Devnet is not responding. Try again, or change the network.";

let online = true;
const goOnline = (next: boolean) => {
  online = next;
  act(() => {
    window.dispatchEvent(new Event(next ? "online" : "offline"));
  });
};

/** The failed-press toast `reportButtonFailure` raises, as its text */
const toasted = (setToast: ReturnType<typeof spyToast>) =>
  setToast.mock.calls.map(([elementable]) => {
    const Toast = elementable as () => React.ReactElement;
    return render(<Toast />).container.textContent;
  });
const spyToast = () =>
  vi.spyOn(PgView, "setToast").mockImplementation(() => undefined);

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  online = true;
  net.input = UP;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  resetTelemetry();
  vi.restoreAllMocks();
  connection.recheck.mockClear();
});

const eventsNamed = (name: string) =>
  sent.events.filter((event) => event.name === name).map((e) => e.params);

describe("BaseStageNotice", () => {
  it("draws nothing without a notice", () => {
    const { container } = render(
      <BaseStageNotice
        notice={undefined}
        onRetry={vi.fn()}
        onChangeNetwork={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("says offline as an alert, with only its close to press", async () => {
    const onDismiss = vi.fn();
    render(
      <BaseStageNotice
        notice={{ kind: "offline", text: OFFLINE }}
        onRetry={vi.fn()}
        onChangeNetwork={vi.fn()}
        onDismiss={onDismiss}
      />
    );
    expect(screen.getByRole("alert").textContent).toBe(OFFLINE);
    expect(
      screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))
    ).toEqual(["Dismiss"]);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("offers Try again and Change network for a cluster that does not answer", async () => {
    const onRetry = vi.fn(() => Promise.resolve());
    const onChangeNetwork = vi.fn();
    render(
      <BaseStageNotice
        notice={{ kind: "cluster-down", text: CLUSTER }}
        onRetry={onRetry}
        onChangeNetwork={onChangeNetwork}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByRole("alert").textContent).toContain(CLUSTER);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Change network" })
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onChangeNetwork).toHaveBeenCalledTimes(1);
  });

  it("keeps Try again busy while it asks, and reports a failed ask", async () => {
    const setToast = spyToast();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    const { rerender } = render(
      <BaseStageNotice
        notice={{ kind: "cluster-down", text: CLUSTER }}
        onRetry={() => pending}
        onChangeNetwork={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    const busy = screen.getByRole("button", { name: /Trying…/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(setToast).not.toHaveBeenCalled();

    // A rejected ask is told, as every AsyncButton's failure is
    rerender(
      <BaseStageNotice
        notice={{ kind: "cluster-down", text: CLUSTER }}
        onRetry={() => Promise.reject(new Error("devnet did not answer"))}
        onChangeNetwork={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await vi.waitFor(() =>
      expect(toasted(setToast)).toEqual(["Could not reach the network."])
    );
  });
});

describe("StageNotice", () => {
  it("shows the offline line and clears it back online, measured once", () => {
    const { rerender } = render(
      <StageNotice stage="build" onOpenNetwork={vi.fn()} />
    );
    expect(screen.queryByRole("alert")).toBeNull();

    goOnline(false);
    expect(screen.getByRole("alert").textContent).toBe(OFFLINE);
    // A stage switch keeps the same onset
    rerender(<StageNotice stage="deploy" onOpenNetwork={vi.fn()} />);
    rerender(<StageNotice stage="build" onOpenNetwork={vi.fn()} />);
    expect(eventsNamed("status_notice_shown")).toEqual([{ notice: "offline" }]);

    goOnline(true);
    expect(screen.queryByRole("alert")).toBeNull();

    // Gone and back is a new onset
    goOnline(false);
    expect(eventsNamed("status_notice_shown")).toEqual([
      { notice: "offline" },
      { notice: "offline" },
    ]);
  });

  it("puts the offline line away until the next time offline, measured", async () => {
    const { rerender } = render(
      <StageNotice stage="build" onOpenNetwork={vi.fn()} />
    );
    goOnline(false);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(eventsNamed("status_notice_dismissed")).toEqual([
      { notice: "offline" },
    ]);
    // A stage switch is the same episode: it stays away
    rerender(<StageNotice stage="deploy" onOpenNetwork={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();

    goOnline(true);
    goOnline(false);
    expect(screen.getByRole("alert").textContent).toBe(OFFLINE);
  });

  it("shows the cluster line after an offline line put away", async () => {
    net.input = DOWN;
    render(<StageNotice stage="deploy" onOpenNetwork={vi.fn()} />);
    goOnline(false);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    // Back online with the cluster still down is another condition
    goOnline(true);
    expect(screen.getByRole("alert").textContent).toContain(CLUSTER);
  });

  it("clears the cluster line by itself when the cluster answers again", () => {
    net.input = DOWN;
    const { rerender } = render(
      <StageNotice stage="deploy" onOpenNetwork={vi.fn()} />
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    net.input = UP;
    rerender(<StageNotice stage="deploy" onOpenNetwork={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fails Try again when the cluster still does not answer", async () => {
    const setToast = spyToast();
    net.input = DOWN;
    connection.recheck.mockResolvedValueOnce(false);
    render(<StageNotice stage="deploy" onOpenNetwork={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await vi.waitFor(() =>
      expect(toasted(setToast)).toEqual(["Could not reach the network."])
    );
  });

  it("shows the cluster line on Deploy only, measured when it first shows", () => {
    net.input = DOWN;
    const { rerender } = render(
      <StageNotice stage="build" onOpenNetwork={vi.fn()} />
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(eventsNamed("status_notice_shown")).toEqual([]);

    rerender(<StageNotice stage="deploy" onOpenNetwork={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain(CLUSTER);
    rerender(<StageNotice stage="interact" onOpenNetwork={vi.fn()} />);
    expect(eventsNamed("status_notice_shown")).toEqual([
      { notice: "cluster-down" },
    ]);
  });

  it("asks the cluster again and opens the network settings, measured", async () => {
    net.input = DOWN;
    const onOpenNetwork = vi.fn();
    render(<StageNotice stage="deploy" onOpenNetwork={onOpenNetwork} />);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Change network" })
    );
    expect(connection.recheck).toHaveBeenCalledTimes(1);
    expect(onOpenNetwork).toHaveBeenCalledTimes(1);
    expect(eventsNamed("status_notice_action")).toEqual([
      { notice: "cluster-down", action: "retry" },
      { notice: "cluster-down", action: "change-network" },
    ]);
  });
});
