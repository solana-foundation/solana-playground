import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

    panel.postMessage({ type: "imported", publicKey: PUBLIC_KEY });
    panel.postMessage({ type: "error", message: "not a keypair" });
    panel.postMessage({ type: "imported" });
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onImported).toHaveBeenCalledExactlyOnceWith(PUBLIC_KEY);
    expect(onError).toHaveBeenCalledWith("not a keypair");
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
