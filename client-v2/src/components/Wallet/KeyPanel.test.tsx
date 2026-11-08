import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";

import { KeyFrameUnavailable } from "../../utils/wallet/key-origin/client";
import type { ThemeTokens } from "../../utils/wallet/key-origin/protocol";
import {
  BaseKeyPanel,
  type BaseKeyPanelProps,
  KEY_PANEL_UNAVAILABLE,
} from "./KeyPanel";

const ORIGIN = "http://127.0.0.1:3006";
const PUBLIC_KEY = "11111111111111111111111111111111";

/** Tokens that follow the page's dark class, as the real computed ones do */
const readTokens = (): ThemeTokens => ({
  bg: document.documentElement.classList.contains("dark") ? "black" : "white",
});

/** A key page that answers at once, and what it is sent */
const fakePanel = () => {
  const channel = new MessageChannel();
  const received: unknown[] = [];
  channel.port2.onmessage = (event) => received.push(event.data);
  const srcs: string[] = [];
  const connect: BaseKeyPanelProps["connect"] = (origin) => () => (src) => {
    expect(origin).toBe(ORIGIN);
    srcs.push(src);
    return Promise.resolve(channel.port1);
  };
  return { connect, received, srcs, panel: channel.port2 };
};

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // Drops reports kept for the first `initLogger`, so a test's log provider
  // sees only its own
  resetLogger();
});

describe("components/Wallet/KeyPanel", () => {
  it("frames the key page's panel, sandboxed, named, over the button's place", async () => {
    const { connect, srcs } = fakePanel();
    const { container } = render(
      <BaseKeyPanel
        action="export"
        publicKey={PUBLIC_KEY}
        name="Wallet 1"
        origin={ORIGIN}
        connect={connect}
        readTokens={readTokens}
        onError={() => {}}
      />
    );

    const frame = screen.getByTitle("Save keypair");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-downloads"
    );
    expect(frame.getAttribute("scrolling")).toBe("no");
    // The hidden button holds the layout and is out of the tab order
    const placeholder = container.querySelector("[data-slot=button]");
    expect(placeholder?.getAttribute("tabindex")).toBe("-1");
    expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(srcs).toHaveLength(1));
    expect(srcs[0]).toContain(`#panel/export/${PUBLIC_KEY}?name=Wallet+1`);
  });

  it("sends the theme again when it changes, and the name when it is edited", async () => {
    const { connect, received } = fakePanel();
    const props = {
      action: "export" as const,
      publicKey: PUBLIC_KEY,
      origin: ORIGIN,
      connect,
      readTokens,
      onError: () => {},
    };
    const { rerender } = render(<BaseKeyPanel {...props} name="Wallet 1" />);
    await waitFor(() =>
      expect(received).toEqual([{ type: "theme", tokens: { bg: "white" } }])
    );

    document.documentElement.classList.add("dark");
    await waitFor(() =>
      expect(received).toContainEqual({
        type: "theme",
        tokens: { bg: "black" },
      })
    );

    rerender(<BaseKeyPanel {...props} name="Mine" />);
    await waitFor(() =>
      expect(received).toContainEqual({ type: "name", name: "Mine" })
    );
  });

  it("hands the panel's results to the dialog", async () => {
    const { connect, panel, srcs } = fakePanel();
    const onImported = vi.fn();
    const onError = vi.fn();
    render(
      <BaseKeyPanel
        action="import"
        origin={ORIGIN}
        connect={connect}
        readTokens={readTokens}
        onImported={onImported}
        onError={onError}
      />
    );
    await waitFor(() => expect(srcs).toHaveLength(1));
    expect(srcs[0]).toContain("#panel/import?");

    panel.postMessage({ type: "imported", publicKey: PUBLIC_KEY, isNew: true });
    panel.postMessage({ type: "error", message: "not a keypair" });
    panel.postMessage({ type: "imported" });
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onImported).toHaveBeenCalledExactlyOnceWith(PUBLIC_KEY, true);
    expect(onError).toHaveBeenCalledWith("not a keypair");
  });

  it("says when the panel is busy, and that it is not once it goes", async () => {
    const { connect, panel, srcs } = fakePanel();
    const onBusy = vi.fn();
    const { unmount } = render(
      <BaseKeyPanel
        action="import"
        origin={ORIGIN}
        connect={connect}
        readTokens={readTokens}
        onBusy={onBusy}
        onError={() => {}}
      />
    );
    await waitFor(() => expect(srcs).toHaveLength(1));

    panel.postMessage({ type: "busy", busy: true });
    panel.postMessage({ type: "busy", busy: true });
    await waitFor(() => expect(onBusy).toHaveBeenCalledWith(true));
    panel.postMessage({ type: "busy", busy: false });
    await waitFor(() => expect(onBusy).toHaveBeenCalledWith(false));
    // Each change once, so a dialog can count its busy panels
    expect(onBusy.mock.calls).toEqual([[true], [false]]);

    panel.postMessage({ type: "busy", busy: true });
    await waitFor(() => expect(onBusy).toHaveBeenCalledTimes(3));
    // Gone mid-task, its "not busy" never arrives: the panel says it itself
    unmount();
    expect(onBusy.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it("passes Escape pressed in the panel on to the dialog", async () => {
    const { connect, panel, srcs } = fakePanel();
    const keys: string[] = [];
    const onKeyDown = (event: KeyboardEvent) => keys.push(event.key);
    document.addEventListener("keydown", onKeyDown);
    try {
      render(
        <BaseKeyPanel
          action="import"
          origin={ORIGIN}
          connect={connect}
          readTokens={readTokens}
          onError={() => {}}
        />
      );
      await waitFor(() => expect(srcs).toHaveLength(1));

      panel.postMessage({ type: "escape" });
      await waitFor(() => expect(keys).toEqual(["Escape"]));
    } finally {
      document.removeEventListener("keydown", onKeyDown);
    }
  });

  it("says the key storage did not load in place of the button", async () => {
    render(
      <BaseKeyPanel
        action="import"
        origin={ORIGIN}
        connect={() => () => () =>
          Promise.reject(new KeyFrameUnavailable("timeout"))}
        readTokens={readTokens}
        onError={() => {}}
      />
    );

    expect(await screen.findByText(KEY_PANEL_UNAVAILABLE)).toBeTruthy();
    expect(KEY_PANEL_UNAVAILABLE).toBe(
      "Key storage didn't load. Reload the page and try again."
    );
    expect(screen.queryByTitle("Import keypair")).toBeNull();
  });

  it("reports a key page that did not load, by its reason only", async () => {
    const logs = logMemory();
    initLogger({ providers: [logs] });
    try {
      render(
        <BaseKeyPanel
          action="import"
          origin={ORIGIN}
          connect={() => () => () =>
            Promise.reject(new KeyFrameUnavailable("timeout"))}
          readTokens={readTokens}
          onError={() => {}}
        />
      );

      await screen.findByText(KEY_PANEL_UNAVAILABLE);
      expect(logs.entries).toHaveLength(1);
      expect(logs.entries[0]).toMatchObject({
        level: "warn",
        message: "key panel did not load",
        report: true,
        context: { reason: "timeout" },
      });
      expect(logs.entries[0].error).toBeUndefined();
    } finally {
      resetLogger();
    }
  });

  it("says so at once when the build names no key origin", () => {
    render(
      <BaseKeyPanel
        action="import"
        // eslint-disable-next-line unicorn/no-null -- the origin lookup's "none"
        origin={null}
        connect={fakePanel().connect}
        readTokens={readTokens}
        onError={() => {}}
      />
    );
    expect(screen.getByText(KEY_PANEL_UNAVAILABLE)).toBeTruthy();
  });
});
