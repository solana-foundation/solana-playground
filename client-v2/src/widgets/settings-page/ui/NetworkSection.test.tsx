import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DEFAULT_ENDPOINT } from "@/constants";
import { PgCustomRpcs } from "@/entities/custom-rpc";

import NetworkSection from "./NetworkSection";

// The real `@/utils` needs the app's build-time globals; the section only
// reads the deploy state, the endpoint and the toast from it
const { state } = vi.hoisted(() => ({
  state: {
    deployState: "ready" as string,
    endpoint: "",
    toasts: [] as (string | undefined)[],
  },
}));
vi.mock("@/utils", () => ({
  PgGlobal: {
    get deployState() {
      return state.deployState;
    },
  },
  PgSettings: {
    connection: {
      get endpoint() {
        return state.endpoint;
      },
      set endpoint(url: string) {
        state.endpoint = url;
      },
    },
    onDidChangeConnectionEndpoint: () => ({ dispose: () => {} }),
  },
  PgView: {
    setToast: (_: unknown, props: { options?: { name?: string } }) => {
      state.toasts.push(props.options?.name);
    },
    closeToast: () => {},
  },
}));
vi.mock("@/hooks", () => ({ useRenderOnChange: () => {} }));

const HELIUS = { name: "Helius", url: "https://h.test/" };

beforeEach(() => {
  // the chips measure themselves with one; jsdom has none
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  localStorage.clear();
  PgCustomRpcs.save(HELIUS);
  state.deployState = "ready";
  state.endpoint = HELIUS.url;
  state.toasts = [];
});

afterEach(() => localStorage.clear());

it("keeps the RPC in use while a deploy runs, rather than removing it", async () => {
  state.deployState = "loading";
  render(<NetworkSection />);

  await userEvent.click(screen.getByRole("button", { name: "Remove Helius" }));

  expect(PgCustomRpcs.list()).toEqual([HELIUS]);
  expect(state.endpoint).toBe(HELIUS.url);
  expect(state.toasts).toEqual(["network-held-by-deploy"]);
});

it("refuses a new URL for the RPC in use while a deploy runs", async () => {
  state.deployState = "paused";
  render(<NetworkSection />);

  await userEvent.click(screen.getByRole("button", { name: "Edit Helius" }));
  const url = screen.getByLabelText("RPC URL");
  await userEvent.clear(url);
  await userEvent.type(url, "https://other.test{Enter}");

  expect(PgCustomRpcs.list()).toEqual([HELIUS]);
  expect(state.endpoint).toBe(HELIUS.url);
  expect(
    screen.getByText("A deploy is running. Change the URL when it ends.")
  ).toBeTruthy();
});

it("renames the RPC in use while a deploy runs", async () => {
  state.deployState = "loading";
  render(<NetworkSection />);

  await userEvent.click(screen.getByRole("button", { name: "Edit Helius" }));
  const name = screen.getByLabelText("Name");
  await userEvent.clear(name);
  await userEvent.type(name, "Mine{Enter}");

  expect(PgCustomRpcs.list()).toEqual([{ name: "Mine", url: HELIUS.url }]);
  expect(state.endpoint).toBe(HELIUS.url);
});

it("removes the RPC in use once no deploy runs, moving to Devnet", async () => {
  render(<NetworkSection />);

  await userEvent.click(screen.getByRole("button", { name: "Remove Helius" }));

  expect(PgCustomRpcs.list()).toEqual([]);
  expect(state.endpoint).toBe(DEFAULT_ENDPOINT);
  expect(state.toasts).toEqual(["custom-rpc-removed"]);
});

it("puts the saved RPCs between the chips and the card's foot", () => {
  state.endpoint = DEFAULT_ENDPOINT;
  render(<NetworkSection />);
  const order = [
    screen.getByRole("radiogroup", { name: "Network" }),
    screen.getByRole("list", { name: "Custom RPCs" }),
    screen.getByRole("button", { name: "Add custom RPC" }),
    screen.getByText("Deploys with free devnet SOL"),
  ];
  for (let i = 1; i < order.length; i++) {
    expect(
      order[i - 1].compareDocumentPosition(order[i]) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  }
});
