// @vitest-environment jsdom -- the panel draws into the key page's document
import { waitFor } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KeyReply, KeyRequest, PanelMessage } from "../protocol";
import { base58Encode } from "./handler";
import { type PanelRoute, runPanelWith } from "./panel";
import type { KeyStore } from "./store";

const PUBLIC_KEY = "11111111111111111111111111111111";
const SECRET = Uint8Array.from({ length: 64 }, (_, i) => i);

/** A promise and the hand that settles it */
const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const storeOf = (all: KeyStore["all"]): KeyStore => ({
  all,
  put: async () => {},
  remove: async () => {},
});

const unused = async (): Promise<KeyReply> => {
  throw new Error("the panel asked its handler unexpectedly");
};

const EMPTY = storeOf(async () => new Map());

/**
 * @returns for a route, a running panel, the page's end of its port, what the
 * page is sent, and the hand that delivers the port
 */
const startPanelWith =
  (handle: (request: KeyRequest) => Promise<KeyReply>, store: KeyStore) =>
  (route: PanelRoute) => {
    const channel = new MessageChannel();
    const received: PanelMessage[] = [];
    channel.port2.onmessage = (event: MessageEvent<PanelMessage>) =>
      received.push(event.data);
    closers.push(() => channel.port2.close());
    const connected = deferred<MessagePort>();
    runPanelWith(handle, store)(route, connected.promise);
    const button = document.querySelector("button");
    const input = document.querySelector<HTMLInputElement>("input[type=file]");
    if (!button || !input) throw new Error("the panel drew no button or input");
    const connect = async () => {
      connected.resolve(channel.port1);
      await waitFor(() => expect(button.disabled).toBe(false));
    };
    return { button, input, received, connect };
  };

const EXPORT: PanelRoute = {
  mode: "export",
  publicKey: PUBLIC_KEY,
  name: "Mine",
  theme: {},
};

let downloads: string[];
let closers: (() => void)[];
beforeEach(() => {
  downloads = [];
  closers = [];
  URL.createObjectURL = vi.fn(() => "blob:key-file");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    downloads.push(this.download);
  });
});
afterEach(() => {
  for (const close of closers) close();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("utils/wallet/key-origin/frame/panel: runPanelWith", () => {
  it("keeps its button disabled until the app's port arrives", async () => {
    const { button, connect } = startPanelWith(unused, EMPTY)(EXPORT);
    expect(button.textContent).toBe("Save keypair");
    expect(button.disabled).toBe(true);

    await connect();
    expect(button.disabled).toBe(false);
  });

  it("is busy around a save, and saves the key file under the wallet's name", async () => {
    const all = deferred<Map<string, Uint8Array>>();
    const { button, received, connect } = startPanelWith(
      unused,
      storeOf(() => all.promise)
    )(EXPORT);
    await connect();

    button.click();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    await waitFor(() =>
      expect(received).toEqual([{ type: "busy", busy: true }])
    );

    all.resolve(new Map([[PUBLIC_KEY, SECRET]]));
    await waitFor(() =>
      expect(received).toEqual([
        { type: "busy", busy: true },
        { type: "exported" },
        { type: "busy", busy: false },
      ])
    );
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute("aria-busy")).toBe(false);
    expect(downloads).toEqual(["Mine-keypair.json"]);
  });

  it("is no longer busy after a task throws, and names only the error's type", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failure = new Error("quota exceeded for [1,2,3]");
    failure.name = "QuotaExceededError";
    const { button, received, connect } = startPanelWith(
      unused,
      storeOf(() => Promise.reject(failure))
    )(EXPORT);
    await connect();

    button.click();
    await waitFor(() => expect(received).toHaveLength(3));
    expect(received).toEqual([
      { type: "busy", busy: true },
      { type: "error", message: "The key page failed: QuotaExceededError" },
      { type: "busy", busy: false },
    ]);
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute("aria-busy")).toBe(false);
    // Logged on the key page by its type alone, never its message
    expect(consoleError).toHaveBeenCalledWith(
      "The key page failed:",
      "QuotaExceededError"
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("[1,2,3]");
    expect(downloads).toEqual([]);
  });

  it("says no key is stored for an account the store lacks", async () => {
    const { button, received, connect } = startPanelWith(unused, EMPTY)(EXPORT);
    await connect();

    button.click();
    await waitFor(() => expect(received).toHaveLength(3));
    expect(received[1]).toEqual({
      type: "error",
      message: `No key for account ${PUBLIC_KEY}`,
    });
    expect(downloads).toEqual([]);
  });

  it("opens the file picker from its import button, and imports the picked file", async () => {
    const requests: KeyRequest["type"][] = [];
    const handle = async (request: KeyRequest): Promise<KeyReply> => {
      requests.push(request.type);
      return { id: request.id, ok: true, result: [] };
    };
    const { button, input, received, connect } = startPanelWith(
      handle,
      EMPTY
    )({
      mode: "import",
      theme: {},
    });
    expect(button.textContent).toBe("Import keypair");
    expect(input.hidden).toBe(true);
    const pick = vi.spyOn(input, "click").mockImplementation(() => {});
    await connect();

    button.click();
    expect(pick).toHaveBeenCalledOnce();

    const file = new File([JSON.stringify(Array.from(SECRET))], "k.json");
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => expect(received).toHaveLength(3));
    expect(received[1]).toEqual({
      type: "imported",
      publicKey: base58Encode(SECRET.slice(32)),
      isNew: true,
    });
    expect(requests).toEqual(["accounts", "adopt"]);
  });
});
