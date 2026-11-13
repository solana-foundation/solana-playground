import { beforeEach, describe, expect, it, vi } from "vitest";

// The real `@/utils` needs the app's build-time globals; the pick only reads
// the hold, writes the endpoint and shows a toast
const { state } = await vi.hoisted(async () => ({
  state: {
    deployState: "ready" as string,
    isIdlWriting: false,
    endpoint: (
      await import("@/entities/cluster/model/endpoint")
    ).Endpoint.DEVNET as string,
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
  },
  PgView: {
    setToast: (_: unknown, props: { options?: { name?: string } }) => {
      state.toasts.push(props.options?.name);
    },
  },
}));

import { Endpoint } from "@/entities/cluster";

import { pickNetwork } from "./pick-network";

describe("pickNetwork", () => {
  beforeEach(() => {
    state.deployState = "ready";
    state.isIdlWriting = false;
    state.endpoint = Endpoint.DEVNET;
    state.toasts = [];
  });

  it("moves the network when nothing holds it", () => {
    expect(pickNetwork(Endpoint.MAINNET_BETA)).toBe(true);
    expect(state.endpoint).toBe(Endpoint.MAINNET_BETA);
    expect(state.toasts).toEqual([]);
  });

  // The Deploy stage's "Show <network>" link goes through this pick: an
  // `anchor idl` write's later steps must not reach a network never checked
  it("keeps the network while an anchor idl write runs", () => {
    state.isIdlWriting = true;

    expect(pickNetwork(Endpoint.MAINNET_BETA)).toBe(false);
    expect(state.endpoint).toBe(Endpoint.DEVNET);
    expect(state.toasts).toEqual(["network-held-by-idl"]);
  });

  it.each(["loading", "paused"])(
    "keeps the network while a deploy is %s",
    (deployState) => {
      state.deployState = deployState;

      expect(pickNetwork(Endpoint.MAINNET_BETA)).toBe(false);
      expect(state.endpoint).toBe(Endpoint.DEVNET);
      expect(state.toasts).toEqual(["network-held-by-deploy"]);
    }
  );
});
