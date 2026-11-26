// The deploy card's key panel when its chunk does or does not load.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KEY_PANEL_LOAD_FAILED, loadKeyPanel } from "./lazy-key-panel";

const PROPS = {
  action: "export" as const,
  publicKey: "Pub1ic",
  name: "Wallet 1",
  onExported: () => {},
};

describe("loadKeyPanel", () => {
  it("hands over the key panel its chunk holds", async () => {
    const KeyPanel = () => <span>the key page's button</span>;

    const { default: Loaded } = await loadKeyPanel(() =>
      Promise.resolve({ KeyPanel })
    )();

    expect(Loaded).toBe(KeyPanel);
  });

  it("leaves a Save keypair that says the chunk did not load", async () => {
    const onError = vi.fn();

    const { default: Loaded } = await loadKeyPanel(() =>
      Promise.reject(new Error("Loading chunk 42 failed"))
    )();
    render(<Loaded {...PROPS} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Save keypair" }));

    expect(onError).toHaveBeenCalledWith(KEY_PANEL_LOAD_FAILED);
  });
});
