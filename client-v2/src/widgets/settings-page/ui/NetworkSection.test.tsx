import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ENDPOINT } from "@/constants";
import { Endpoint, PgCustomRpcs } from "@/entities/cluster";

// The real `@/utils` needs the app's build-time globals; the section only
// reads the deploy state, the endpoint and the toast from it
const { state } = vi.hoisted(() => ({
  state: {
    deployState: "ready" as string,
    isIdlWriting: false,
    endpoint: "",
    toasts: [] as (string | undefined)[],
  },
}));
vi.mock("@/utils", () => ({
  PgGlobal: {
    get deployState() {
      return state.deployState;
    },
    get isIdlWriting() {
      return state.isIdlWriting;
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

import NetworkSection from "./NetworkSection";

const DEVNET = `${Endpoint.DEVNET}/`;

const stubRpcAnswering = () =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response('{"result":"ok"}'));

const stubRpcNotAnswering = () =>
  vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new TypeError("Failed to fetch"));

const addRpc = async (name: string, url: string) => {
  await userEvent.click(screen.getByRole("button", { name: "Add custom RPC" }));
  await userEvent.type(screen.getByLabelText("Name"), name);
  await userEvent.type(screen.getByLabelText("RPC URL"), `${url}{Enter}`);
};

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
});

describe("NetworkSection", () => {
  beforeEach(() => {
    state.deployState = "ready";
    state.toasts = [];
    localStorage.clear();
    state.endpoint = DEVNET;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("picks a new RPC whose URL answers", async () => {
    stubRpcAnswering();
    render(<NetworkSection />);
    await addRpc("Triton", "https://t.test");
    // Its chip and its row in the list
    expect(await screen.findByRole("radio", { name: "Triton" })).toBeTruthy();
    expect(state.endpoint).toBe("https://t.test/");
  });

  it("picks a new RPC saved through Use anyway, and not before", async () => {
    stubRpcNotAnswering();
    render(<NetworkSection />);
    await addRpc("Dead", "https://dead.test");
    await screen.findByText("This URL is not responding.");
    expect(state.endpoint).toBe(DEVNET);
    await userEvent.click(screen.getByRole("button", { name: "Use anyway" }));
    expect(state.endpoint).toBe("https://dead.test/");
  });

  it("saves Devnet's URL under a name of its own, beside the Devnet chip", async () => {
    stubRpcAnswering();
    render(<NetworkSection />);
    await addRpc("Public Devnet", DEVNET);
    expect(
      await screen.findByRole("radio", { name: "Public Devnet" })
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Devnet" })).toBeTruthy();
    expect(PgCustomRpcs.list()).toEqual([
      { name: "Public Devnet", url: DEVNET },
    ]);
    // The new chip is the one checked, though Devnet shares its URL
    expect(
      screen
        .getByRole("radio", { name: "Public Devnet" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole("radio", { name: "Devnet" }).getAttribute("aria-checked")
    ).toBe("false");
  });

  it("refuses an entry with the name and the URL of one saved", async () => {
    stubRpcAnswering();
    render(<NetworkSection />);
    await addRpc("Helius", "https://helius.test");
    await screen.findByRole("radio", { name: "Helius" });
    await addRpc("Helius", "https://HELIUS.test/");
    expect(await screen.findByText("Already saved as Helius.")).toBeTruthy();
    expect(PgCustomRpcs.list()).toHaveLength(1);
  });

  it("checks the chip picked before the reload, though another shares its URL", () => {
    localStorage.setItem(
      "customRpcs",
      JSON.stringify([
        { name: "First", url: DEVNET },
        { name: "Public Devnet", url: DEVNET },
      ])
    );
    localStorage.setItem("customRpcChosen", `Public Devnet\n${DEVNET}`);
    render(<NetworkSection />);
    const checked = screen
      .getAllByRole("radio")
      .filter((r) => r.getAttribute("aria-checked") === "true")
      .map((r) => r.textContent);
    expect(checked).toEqual(["Public Devnet"]);
  });

  it("stores the chip clicked, and checks it again after a remount", async () => {
    localStorage.setItem(
      "customRpcs",
      JSON.stringify([
        { name: "A", url: "https://same.test/" },
        { name: "B", url: "https://same.test/" },
      ])
    );
    state.endpoint = "https://same.test/";
    const { unmount } = render(<NetworkSection />);
    await userEvent.click(screen.getByRole("radio", { name: "B" }));
    expect(PgCustomRpcs.chosen()).toBe("B\nhttps://same.test/");
    unmount();
    render(<NetworkSection />);
    expect(
      screen.getByRole("radio", { name: "B" }).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("keeps the network when the RPC removed shares its URL with another", async () => {
    localStorage.setItem(
      "customRpcs",
      JSON.stringify([
        { name: "A", url: "https://same.test/" },
        { name: "B", url: "https://same.test/" },
      ])
    );
    state.endpoint = "https://same.test/";
    render(<NetworkSection />);
    await userEvent.click(screen.getByRole("button", { name: "Remove A" }));
    expect(PgCustomRpcs.list()).toEqual([
      { name: "B", url: "https://same.test/" },
    ]);
    expect(state.endpoint).toBe("https://same.test/");
  });

  it("keeps the network when a chip on its URL that is not the checked one is edited", async () => {
    localStorage.setItem(
      "customRpcs",
      JSON.stringify([
        { name: "A", url: "https://same.test/" },
        { name: "B", url: "https://same.test/" },
      ])
    );
    state.endpoint = "https://same.test/";
    stubRpcAnswering();
    render(<NetworkSection />);
    // A is the checked chip: the first on the URL
    await userEvent.click(screen.getByRole("button", { name: "Edit B" }));
    await userEvent.clear(screen.getByLabelText("RPC URL"));
    await userEvent.type(
      screen.getByLabelText("RPC URL"),
      "https://b2.test{Enter}"
    );
    await waitFor(() => expect(screen.queryByLabelText("RPC URL")).toBeNull());
    expect(state.endpoint).toBe("https://same.test/");
    expect(PgCustomRpcs.list()).toEqual([
      { name: "A", url: "https://same.test/" },
      { name: "B", url: "https://b2.test/" },
    ]);
  });

  it("moves the network with the checked chip when it is edited", async () => {
    localStorage.setItem(
      "customRpcs",
      JSON.stringify([
        { name: "A", url: "https://same.test/" },
        { name: "B", url: "https://same.test/" },
      ])
    );
    state.endpoint = "https://same.test/";
    stubRpcAnswering();
    render(<NetworkSection />);
    await userEvent.click(screen.getByRole("radio", { name: "B" }));
    // A click on a chip on the URL in use moves the check only
    expect(state.endpoint).toBe("https://same.test/");
    await userEvent.click(screen.getByRole("button", { name: "Edit B" }));
    await userEvent.clear(screen.getByLabelText("RPC URL"));
    await userEvent.type(
      screen.getByLabelText("RPC URL"),
      "https://b2.test{Enter}"
    );
    await waitFor(() => expect(state.endpoint).toBe("https://b2.test/"));
  });

  it("lands on Devnet when the RPC removed is on Devnet's address spelt with a slash", async () => {
    localStorage.setItem(
      "customRpcs",
      JSON.stringify([{ name: "Mine", url: DEVNET }])
    );
    render(<NetworkSection />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Mine" }));
    expect(PgCustomRpcs.list()).toEqual([]);
    expect(state.endpoint).toBe(DEFAULT_ENDPOINT);
  });

  it("leaves the connection alone when an RPC not in use is edited", async () => {
    localStorage.setItem(
      "customRpcs",
      JSON.stringify([{ name: "Other", url: "https://other.test/" }])
    );
    stubRpcAnswering();
    render(<NetworkSection />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Other" }));
    await userEvent.clear(screen.getByLabelText("RPC URL"));
    await userEvent.type(
      screen.getByLabelText("RPC URL"),
      "https://other2.test{Enter}"
    );
    await screen.findByRole("radio", { name: "Other" });
    await waitFor(() => expect(screen.queryByLabelText("RPC URL")).toBeNull());
    expect(state.endpoint).toBe(DEVNET);
  });

  it("moves the connection with an edit of the RPC in use, through Use anyway", async () => {
    localStorage.setItem(
      "customRpcs",
      JSON.stringify([{ name: "Mine", url: "https://mine.test/" }])
    );
    state.endpoint = "https://mine.test/";
    stubRpcNotAnswering();
    render(<NetworkSection />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Mine" }));
    await userEvent.clear(screen.getByLabelText("RPC URL"));
    await userEvent.type(
      screen.getByLabelText("RPC URL"),
      "https://mine2.test{Enter}"
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Use anyway" })
    );
    expect(state.endpoint).toBe("https://mine2.test/");
  });
});

describe("NetworkSection while a deploy runs", () => {
  const HELIUS = { name: "Helius", url: "https://h.test/" };

  beforeEach(() => {
    localStorage.clear();
    PgCustomRpcs.save(HELIUS);
    state.deployState = "ready";
    state.isIdlWriting = false;
    state.endpoint = HELIUS.url;
    state.toasts = [];
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("names an anchor idl write when one holds the network", async () => {
    state.isIdlWriting = true;
    render(<NetworkSection />);

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Helius" })
    );

    expect(PgCustomRpcs.list()).toEqual([HELIUS]);
    expect(state.endpoint).toBe(HELIUS.url);
    expect(state.toasts).toEqual(["network-held-by-idl"]);
  });

  it("keeps the RPC in use, rather than removing it", async () => {
    state.deployState = "loading";
    render(<NetworkSection />);

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Helius" })
    );

    expect(PgCustomRpcs.list()).toEqual([HELIUS]);
    expect(state.endpoint).toBe(HELIUS.url);
    expect(state.toasts).toEqual(["network-held-by-deploy"]);
  });

  it("refuses a new URL for the RPC in use, before any health check", async () => {
    state.deployState = "paused";
    const fetch = vi.spyOn(globalThis, "fetch");
    render(<NetworkSection />);

    await userEvent.click(screen.getByRole("button", { name: "Edit Helius" }));
    const url = screen.getByLabelText("RPC URL");
    await userEvent.clear(url);
    await userEvent.type(url, "https://other.test{Enter}");

    expect(
      await screen.findByText(
        "A deploy is running. Change the URL when it ends."
      )
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(PgCustomRpcs.list()).toEqual([HELIUS]);
    expect(state.endpoint).toBe(HELIUS.url);
  });

  it("refuses a new URL for the RPC in use when a deploy starts during its check", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      state.deployState = "loading";
      return new Response('{"result":"ok"}');
    });
    render(<NetworkSection />);

    await userEvent.click(screen.getByRole("button", { name: "Edit Helius" }));
    const url = screen.getByLabelText("RPC URL");
    await userEvent.clear(url);
    await userEvent.type(url, "https://other.test{Enter}");

    expect(
      await screen.findByText(
        "A deploy is running. Change the URL when it ends."
      )
    ).toBeTruthy();
    expect(PgCustomRpcs.list()).toEqual([HELIUS]);
    expect(state.endpoint).toBe(HELIUS.url);
  });

  it("refuses Use anyway on the RPC in use once a deploy has started", async () => {
    stubRpcNotAnswering();
    render(<NetworkSection />);

    await userEvent.click(screen.getByRole("button", { name: "Edit Helius" }));
    const url = screen.getByLabelText("RPC URL");
    await userEvent.clear(url);
    await userEvent.type(url, "https://other.test{Enter}");
    const useAnyway = await screen.findByRole("button", {
      name: "Use anyway",
    });
    state.deployState = "paused";
    await userEvent.click(useAnyway);

    expect(
      await screen.findByText(
        "A deploy is running. Change the URL when it ends."
      )
    ).toBeTruthy();
    expect(PgCustomRpcs.list()).toEqual([HELIUS]);
    expect(state.endpoint).toBe(HELIUS.url);
  });

  it("saves a new URL for an RPC not in use", async () => {
    state.deployState = "loading";
    state.endpoint = DEVNET;
    stubRpcAnswering();
    render(<NetworkSection />);

    await userEvent.click(screen.getByRole("button", { name: "Edit Helius" }));
    const url = screen.getByLabelText("RPC URL");
    await userEvent.clear(url);
    await userEvent.type(url, "https://other.test{Enter}");

    await waitFor(() =>
      expect(PgCustomRpcs.list()).toEqual([
        { name: "Helius", url: "https://other.test/" },
      ])
    );
    expect(state.endpoint).toBe(DEVNET);
  });

  it("renames the RPC in use", async () => {
    state.deployState = "loading";
    render(<NetworkSection />);

    await userEvent.click(screen.getByRole("button", { name: "Edit Helius" }));
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Mine{Enter}");

    await waitFor(() =>
      expect(PgCustomRpcs.list()).toEqual([{ name: "Mine", url: HELIUS.url }])
    );
    expect(state.endpoint).toBe(HELIUS.url);
  });

  it("removes the RPC in use once no deploy runs, moving to Devnet", async () => {
    render(<NetworkSection />);

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Helius" })
    );

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
});
