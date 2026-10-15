import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import { PgView } from "../../utils";
import Settings from "./Settings";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../utils", () => ({
  PgCommand: { connect: { execute: vi.fn() } },
  PgView: {
    ids: { WALLET_RENAME_INPUT: "wallet-rename-input" },
    setModal: vi.fn(),
    setToast: vi.fn(),
  },
  PgWallet: {
    current: {
      isPg: true,
      publicKey: { toBase58: () => "address" },
    },
    standardWallets: [],
    import: vi.fn(),
    export: vi.fn(),
  },
}));

vi.mock("../../hooks", () => ({ useCopy: () => [false, vi.fn()] }));
vi.mock("./hooks", () => ({
  useAirdrop: () => ({ airdrop: vi.fn(), airdropCondition: false }),
  useDarken: () => ({ darken: vi.fn(), lighten: vi.fn() }),
}));

// The icons and the button are styled-components that read the app theme;
// they are not what is under test.
vi.mock("../Icons", () => {
  const Icon = () => <svg aria-hidden />;
  return {
    Airdrop: Icon,
    Copy: Icon,
    Edit: Icon,
    ExportFile: Icon,
    ImportFile: Icon,
    Plus: Icon,
    ThreeDots: Icon,
    Trash: Icon,
  };
});
vi.mock("../Button", async () => {
  const { forwardRef } = await import("react");
  return {
    // Radix's `asChild` hands its props and ref to this element
    default: forwardRef<HTMLButtonElement>((props, ref) => (
      <button type="button" ref={ref} {...props} />
    )),
  };
});
vi.mock("../Img", () => ({ default: () => null }));
vi.mock("./Modals/Add", () => ({ Add: () => null }));

let logs: ReturnType<typeof logMemory>;
beforeEach(() => {
  logs = logMemory();
  initLogger({ providers: [logs] });
});
afterEach(() => {
  vi.clearAllMocks();
  resetLogger();
});

/** What `Wallet.tsx` does: the rename input appears once `showRename` ran */
const Host = () => {
  const [rename, setRename] = useState(false);
  return (
    <>
      <Settings showRename={() => setRename(true)} />
      {rename && <input id="wallet-rename-input" aria-label="Rename" />}
    </>
  );
};

const openMenu = async () => {
  const trigger = screen.getByTitle("More");
  trigger.focus();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return await screen.findByRole("menu");
};

describe("wallet Settings menu", () => {
  it("focuses the rename input after Rename, not the trigger", async () => {
    render(<Host />);
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));

    const input = await screen.findByLabelText("Rename");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("leaves focus to Radix's return to the trigger after Copy address, even with the rename input mounted", async () => {
    // The input is there from the start, so only the `choseRename` guard
    // keeps focus off it
    render(
      <>
        <Settings showRename={vi.fn()} />
        <input id="wallet-rename-input" aria-label="Rename" />
      </>
    );
    const trigger = screen.getByTitle("More");
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Copy address/ }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.activeElement).not.toBe(screen.getByLabelText("Rename"));
  });

  it("reports a modal that fails to open and tells the user", async () => {
    const failure = new Error("chunk failed");
    vi.mocked(PgView.setModal).mockRejectedValueOnce(failure);
    render(<Host />);
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Add/ }));

    await waitFor(() => expect(PgView.setToast).toHaveBeenCalledTimes(1));
    expect(vi.mocked(PgView.setToast).mock.calls[0][1]).toEqual({
      options: { name: "menu-action-failed" },
    });
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0].ns).toBe("wallet:settings");
    expect(logs.entries[0].level).toBe("error");
    expect(logs.entries[0].report).toBe(true);
    expect(logs.entries[0].error).toBe(failure);
  });
});
