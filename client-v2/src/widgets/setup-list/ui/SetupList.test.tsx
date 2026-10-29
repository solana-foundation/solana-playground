import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SETUP_REJECTED } from "@/commands/connect/setup-rejected";
import { PgSession } from "@/features/auth";
import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { SETUP_LIST_KEY, setupMarks } from "../model/storage";
import SetupList from "./SetupList";

const cluster = vi.hoisted(() => ({ name: "devnet" as string | null }));
const wallet = vi.hoisted(() => ({
  current: null as null | undefined | { publicKey: { toBase58: () => string } },
}));
const assistant = vi.hoisted(() => ({ connected: false }));
const connect = vi.hoisted(() => ({ execute: vi.fn() }));
const setToast = vi.hoisted(() => vi.fn());

// The hooks and utils barrels read generated globals that exist only in the built app
vi.mock("@/hooks", () => ({
  // Only the cluster's subscription returns a value; the others re-render
  useRenderOnChange: () => cluster.name,
  useWallet: () => wallet.current,
}));
vi.mock("@/utils", () => ({
  PgCommand: { connect },
  PgConnection: { onDidChangeCluster: () => ({ dispose: () => {} }) },
  PgView: { setToast },
}));
vi.mock("@/views/sidebar/assistant/store", () => ({
  PgAssistant: {
    get isConnected() {
      return assistant.connected;
    },
    onDidChange: () => ({ dispose: () => {} }),
  },
}));

const ADDRESS = "7Hq5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXk2P";

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof logMemory>;
beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = logMemory();
  initLogger({ providers: [logged] });
  connect.execute.mockResolvedValue(undefined);
});
afterEach(() => {
  resetTelemetry();
  resetLogger();
  vi.restoreAllMocks();
  connect.execute.mockReset();
  setToast.mockReset();
  wallet.current = null;
  assistant.connected = false;
  localStorage.clear();
  // What another tab clearing the site's storage looks like: marks start over.
  // In `act`: the list is still mounted, RTL's own cleanup runs after this hook
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  PgSession.reset();
});

const draw = (defaultFolded?: boolean) => {
  const onConnectAssistant = vi.fn();
  const view = render(
    <SetupList
      onConnectAssistant={onConnectAssistant}
      defaultFolded={defaultFolded}
    />
  );
  return { onConnectAssistant, view };
};

/** A reload: the page's memory goes, and storage is read again */
const reload = (view: ReturnType<typeof render>) => {
  view.unmount();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
};

const listShown = () =>
  screen.queryByRole("button", { name: "Connect a wallet" }) !== null;

const title = () => screen.queryByRole("button", { name: /^Get set up/ });

/** What this widget logged, without what `PgSession` logs of its own */
const ours = () =>
  logged.entries.filter((entry) => entry.ns === "setup-list:actions");

const eventsNamed = (name: string) =>
  sent.events.filter((event) => event.name === name).map((e) => e.params);

const signInAsTester = () =>
  PgSession.refreshWith({ id: "u1", name: "Tester", image: null, login: "t" });

const doAllFour = async () => {
  assistant.connected = true;
  wallet.current = { publicKey: { toBase58: () => ADDRESS } };
  await signInAsTester();
};

it("counts the default network as done on a fresh device", () => {
  draw();
  expect(title()?.textContent).toBe("Get set up· 1 of 4");
  expect(screen.getByText("devnet")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Choose a network" })).toBeNull();
});

it("ticks the network step before the cluster is known, with no value", () => {
  cluster.name = null;
  try {
    draw();
    expect(title()?.textContent).toBe("Get set up· 1 of 4");
  } finally {
    cluster.name = "devnet";
  }
});

it("stays folded after a reload", async () => {
  const { view } = draw();
  await userEvent.click(title()!);
  expect(listShown()).toBe(false);
  reload(view);
  draw();
  expect(listShown()).toBe(false);
});

it("stays unfolded after a reload once unfolded again", async () => {
  const { view } = draw();
  await userEvent.click(title()!);
  await userEvent.click(title()!);
  reload(view);
  draw();
  expect(listShown()).toBe(true);
});

it("keeps a fold from elsewhere on the device over the phone's default", () => {
  localStorage.setItem(
    SETUP_LIST_KEY,
    '{"dismissed":false,"completed":false,"folded":false}'
  );
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  draw(true);
  expect(listShown()).toBe(true);
});

it("starts folded on a phone's menu until the user unfolds it there", async () => {
  const { view } = draw(true);
  expect(listShown()).toBe(false);
  await userEvent.click(title()!);
  reload(view);
  draw(true);
  expect(listShown()).toBe(true);
});

it("ticks the GitHub step with the login once signed in", async () => {
  await signInAsTester();
  draw();
  expect(title()?.textContent).toBe("Get set up· 2 of 4");
  expect(screen.getByText("t")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Sign in with GitHub" })
  ).toBeNull();
});

it("leaves the wallet step to do before the wallet store has answered", () => {
  // `useRenderOnChange` holds `undefined` until the first change
  wallet.current = undefined;
  draw();
  expect(screen.getByRole("button", { name: "Connect a wallet" })).toBeTruthy();
});

it("ticks the wallet step with the short address", () => {
  wallet.current = { publicKey: { toBase58: () => ADDRESS } };
  draw();
  expect(screen.getByText("7Hq5…Xk2P")).toBeTruthy();
});

it("starts a sign-in from its step", async () => {
  const signIn = vi.spyOn(PgSession, "signIn").mockResolvedValue();
  draw();
  await userEvent.click(
    screen.getByRole("button", { name: "Sign in with GitHub" })
  );
  expect(signIn).toHaveBeenCalledOnce();
  expect(eventsNamed("setup_item_picked")).toEqual([{ item: "github" }]);
});

it("logs a failed sign-in at info, with no report", async () => {
  // A refused start is a known failure (`isSignInFailure`)
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 500 })
  );
  draw();
  await userEvent.click(
    screen.getByRole("button", { name: "Sign in with GitHub" })
  );
  await vi.waitFor(() =>
    expect(ours()).toEqual([expect.objectContaining({ level: "info" })])
  );
});

it("reports a sign-in that throws for another reason", async () => {
  vi.spyOn(PgSession, "signIn").mockRejectedValue(new Error("boom"));
  draw();
  await userEvent.click(
    screen.getByRole("button", { name: "Sign in with GitHub" })
  );
  await vi.waitFor(() =>
    expect(ours()).toEqual([
      expect.objectContaining({ level: "error", report: true }),
    ])
  );
});

it("logs a closed wallet setup at info, with no toast", async () => {
  connect.execute.mockRejectedValue(new Error(SETUP_REJECTED));
  draw();
  await userEvent.click(
    screen.getByRole("button", { name: "Connect a wallet" })
  );
  await vi.waitFor(() =>
    expect(logged.entries).toEqual([
      expect.objectContaining({ ns: "setup-list:actions", level: "info" }),
    ])
  );
  expect(setToast).not.toHaveBeenCalled();
});

it("reports a wallet connection that fails, and tells the user", async () => {
  connect.execute.mockRejectedValue(new Error("boom"));
  draw();
  await userEvent.click(
    screen.getByRole("button", { name: "Connect a wallet" })
  );
  await vi.waitFor(() => expect(setToast).toHaveBeenCalledOnce());
  expect(ours()).toEqual([
    expect.objectContaining({ level: "error", report: true }),
  ]);
});

it("hands the assistant step to its prop, counted", async () => {
  const { onConnectAssistant } = draw();
  await userEvent.click(
    screen.getByRole("button", { name: "Connect the assistant" })
  );
  expect(onConnectAssistant).toHaveBeenCalledOnce();
  expect(eventsNamed("setup_item_picked")).toEqual([{ item: "assistant" }]);
});

it("goes for good once dismissed", async () => {
  wallet.current = { publicKey: { toBase58: () => ADDRESS } };
  draw();
  await userEvent.click(
    screen.getByRole("button", { name: "Dismiss the checklist" })
  );
  expect(title()).toBeNull();
  expect(eventsNamed("setup_dismissed")).toEqual([{ done: 2 }]);
  expect(JSON.parse(localStorage.getItem(SETUP_LIST_KEY) ?? "{}")).toEqual({
    dismissed: true,
    completed: false,
  });
});

it("never shows with all four done, and counts the completion once", async () => {
  await doAllFour();
  const { view } = draw();
  expect(title()).toBeNull();
  view.rerender(<SetupList onConnectAssistant={vi.fn()} />);
  expect(eventsNamed("setup_completed")).toEqual([{}]);
  expect(JSON.parse(localStorage.getItem(SETUP_LIST_KEY) ?? "{}")).toEqual({
    dismissed: false,
    completed: true,
  });
});

it("does not count the completion again on a later load", async () => {
  await doAllFour();
  setupMarks.mark("completed");
  draw();
  expect(title()).toBeNull();
  expect(eventsNamed("setup_completed")).toEqual([]);
});

it("stays gone after completion when a step is no longer done", async () => {
  await doAllFour();
  draw();
  assistant.connected = false;
  const again = draw();
  expect(again.view.container.textContent).toBe("");
});
