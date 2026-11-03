// The program id block, connected: what each action writes to the program
// info, and the events it sends.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { TooltipProvider } from "@/shared/ui/tooltip";

interface Info {
  kp: Keypair | null;
  customPk: PublicKey | null;
}

const mocks = vi.hoisted(() => ({
  info: { kp: null, customPk: null } as Info,
  deployed: false,
  listeners: new Set<() => void>(),
  updates: [] as Partial<Info>[],
  exported: [] as { name: string; content: unknown }[],
  exportFails: false,
  toast: vi.fn(),
}));

vi.mock("@/utils", async () => {
  const web3 = await import("@solana/web3.js");
  const on = (cb: () => void) => {
    mocks.listeners.add(cb);
    return { dispose: () => mocks.listeners.delete(cb) };
  };
  return {
    PgWeb3: web3,
    PgCommon: {
      export: (name: string, content: unknown) => {
        if (mocks.exportFails) throw new Error("blocked");
        mocks.exported.push({ name, content });
      },
    },
    PgProgramInfo: {
      get kp() {
        return mocks.info.kp;
      },
      get customPk() {
        return mocks.info.customPk;
      },
      get pk() {
        return mocks.info.customPk ?? mocks.info.kp?.publicKey ?? null;
      },
      update: (patch: Partial<Info>) => {
        mocks.updates.push(patch);
        Object.assign(mocks.info, patch);
        mocks.listeners.forEach((cb) => cb());
      },
      onDidChangeKp: on,
      onDidChangeCustomPk: on,
      get onChain() {
        return { deployed: mocks.deployed };
      },
      onDidChangePk: on,
      onDidChangeOnChain: on,
    },
  };
});
vi.mock("@/hooks", async () => {
  const { useEffect, useReducer } = await import("react");
  return {
    useRenderOnChange: (
      onDidChange: (cb: () => void) => { dispose: () => void }
    ) => {
      const [, rerender] = useReducer((n: number) => n + 1, 0);
      useEffect(() => onDidChange(rerender).dispose, [onDidChange]);
      return mocks.info.customPk ?? mocks.info.kp?.publicKey ?? null;
    },
  };
});
vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: (what: string) => (error: unknown) =>
    mocks.toast(what, error),
}));

import ProgramKeypair from "./ProgramKeypair";

const KP = Keypair.fromSeed(new Uint8Array(32).fill(7));
const OTHER = Keypair.fromSeed(new Uint8Array(32).fill(9));

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  mocks.info.kp = KP;
  mocks.info.customPk = null;
  mocks.deployed = false;
  mocks.listeners.clear();
  mocks.updates = [];
  mocks.exported = [];
  mocks.exportFails = false;
  mocks.toast.mockReset();
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => resetTelemetry());

const draw = () =>
  render(
    <TooltipProvider>
      <ProgramKeypair />
    </TooltipProvider>
  );

const openFold = () =>
  fireEvent.click(screen.getByRole("button", { name: "Program id" }));
const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const events = () => sent.events.map((e) => [e.name, e.params]);

const importText = async (text: string) => {
  const input = screen
    .getByText("Drop a program keypair here")
    .closest("label")!
    .querySelector("input")!;
  const file = new File([text], "program-keypair.json");
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};

const field = () =>
  screen.getByRole("textbox", { name: "Program id" }) as HTMLInputElement;

describe("features/program-keypair/ui/ProgramKeypair", () => {
  it("imports a CLI keypair file and clears the custom id", async () => {
    mocks.info.customPk = OTHER.publicKey;
    draw();
    await importText(JSON.stringify(Array.from(OTHER.secretKey)));

    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0].kp?.publicKey.equals(OTHER.publicKey)).toBe(true);
    expect(mocks.updates[0].customPk).toBeNull();
    expect(field().value).toBe(OTHER.publicKey.toBase58());
    expect(events()).toEqual([["keypair_imported", {}]]);
  });

  it("refuses a file that is not a keypair and keeps the old one", async () => {
    draw();
    openFold();
    await importText(JSON.stringify([1, 2, 3]));

    expect(mocks.updates).toEqual([]);
    expect(screen.getByText(/That file is not a program keypair/)).toBeTruthy();
    expect(events()).toEqual([
      ["keypair_import_refused", { reason: "wrong_shape" }],
    ]);
  });

  it("refuses 64 bytes whose public half is not the seed's key", async () => {
    draw();
    openFold();
    const forged = Array.from(KP.secretKey.slice(0, 32)).concat(
      Array.from(OTHER.publicKey.toBytes())
    );
    await importText(JSON.stringify(forged));

    expect(mocks.updates).toEqual([]);
    expect(screen.getByText(/That file is not a program keypair/)).toBeTruthy();
    expect(events()).toEqual([
      ["keypair_import_refused", { reason: "wrong_shape" }],
    ]);
  });

  it("says so when the browser refuses the download, and counts nothing", () => {
    mocks.exportFails = true;
    draw();
    openFold();
    press("Export keypair");

    expect(mocks.toast).toHaveBeenCalledWith(
      "save the program keypair",
      expect.any(Error)
    );
    expect(events()).toEqual([]);
  });

  it("changes nothing when the New keypair dialog is closed", () => {
    draw();
    openFold();
    press("New keypair");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.updates).toEqual([]);
    expect(events()).toEqual([]);
  });

  it("opens and warns when a mismatch appears after mount", () => {
    draw();
    expect(screen.queryByRole("textbox", { name: "Program id" })).toBeNull();

    act(() => {
      mocks.info.customPk = OTHER.publicKey;
      mocks.listeners.forEach((cb) => cb());
    });

    expect(
      screen.getByText(/This program id does not match the program keypair/)
    ).toBeTruthy();
  });

  it("does not warn about a custom id equal to the keypair's", () => {
    mocks.info.customPk = new PublicKey(KP.publicKey.toBase58());
    draw();
    expect(screen.queryByRole("textbox", { name: "Program id" })).toBeNull();
    openFold();
    expect(
      screen.queryByText(/This program id does not match the program keypair/)
    ).toBeNull();
  });

  it("refuses text that is not JSON", async () => {
    draw();
    openFold();
    await importText("not json");
    expect(events()).toEqual([
      ["keypair_import_refused", { reason: "not_json" }],
    ]);
  });

  it("generates at once when there is no keypair", () => {
    mocks.info.kp = null;
    draw();
    openFold();
    press("New keypair");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.updates).toHaveLength(1);
    expect(events()).toEqual([["keypair_generated", { replaced: false }]]);
  });

  it("asks before removing a custom id even with no keypair", () => {
    mocks.info.kp = null;
    mocks.info.customPk = OTHER.publicKey;
    draw();
    openFold();
    press("New keypair");

    expect(mocks.updates).toEqual([]);
    expect(
      screen.getByText(/It also removes the custom program id\./)
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save keypair" })).toBeNull();
  });

  it("does not warn about a custom id already deployed", () => {
    mocks.info.customPk = OTHER.publicKey;
    mocks.deployed = true;
    draw();

    expect(screen.queryByRole("textbox", { name: "Program id" })).toBeNull();
    openFold();
    expect(
      screen.queryByText(/This program id does not match the program keypair/)
    ).toBeNull();
  });

  it("asks before replacing a keypair; Generate replaces it", () => {
    draw();
    openFold();
    press("New keypair");
    expect(mocks.updates).toEqual([]);

    press("Save keypair");
    press("Generate");

    expect(mocks.exported[0].name).toBe("program-keypair.json");
    expect(mocks.updates[0].customPk).toBeNull();
    expect(mocks.updates[0].kp?.publicKey.equals(KP.publicKey)).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(events()).toEqual([
      ["keypair_exported", { from: "dialog" }],
      ["keypair_generated", { replaced: true }],
    ]);
  });

  it("exports the 64 secret-key bytes the CLI reads", () => {
    draw();
    openFold();
    press("Export keypair");

    expect(mocks.exported).toEqual([
      { name: "program-keypair.json", content: Array.from(KP.secretKey) },
    ]);
    expect(events()).toEqual([["keypair_exported", { from: "block" }]]);
  });

  it("sets a valid custom id and refuses an invalid one", () => {
    draw();
    openFold();
    fireEvent.change(field(), { target: { value: "abc" } });
    press("Change program id");
    expect(screen.getByText("Not a valid public key")).toBeTruthy();
    expect(mocks.updates).toEqual([]);

    // Typing again drops the answer to the last press
    fireEvent.change(field(), { target: { value: "abcd" } });
    expect(screen.queryByText("Not a valid public key")).toBeNull();

    fireEvent.change(field(), {
      target: { value: OTHER.publicKey.toBase58() },
    });
    press("Change program id");

    expect(mocks.updates[0].customPk?.equals(OTHER.publicKey)).toBe(true);
    // An id that is not the keypair's: the warning speaks, not a green note
    expect(screen.queryByText("Program id changed")).toBeNull();
    expect(
      screen.getByText(/This program id does not match the program keypair/)
    ).toBeTruthy();
    expect(events()).toEqual([["keypair_custom_id_set", {}]]);
  });

  it("opens on a mismatch, warns, and Remove custom id clears it", () => {
    mocks.info.customPk = OTHER.publicKey;
    draw();

    expect(
      screen.getByText(/This program id does not match the program keypair/)
    ).toBeTruthy();
    press("Remove custom id");

    expect(mocks.updates).toEqual([{ customPk: null }]);
    expect(field().value).toBe(KP.publicKey.toBase58());
    expect(screen.getByText("Custom id removed")).toBeTruthy();
    expect(events()).toEqual([["keypair_custom_id_removed", {}]]);
  });

  it("sends no key in any event", async () => {
    draw();
    openFold();
    press("Export keypair");
    await importText(JSON.stringify(Array.from(OTHER.secretKey)));

    const text = JSON.stringify(sent.events);
    expect(text).not.toContain(KP.publicKey.toBase58());
    expect(text).not.toContain(OTHER.publicKey.toBase58());
  });
});
