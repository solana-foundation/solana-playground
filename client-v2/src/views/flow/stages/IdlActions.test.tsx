// The IDL's two doors: download what the build produced, and upload a file
// into the browser by picking it.
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  idl: null as unknown,
}));

vi.mock("../../../utils", () => ({
  PgCommon: { getDataUrl: () => "data:application/json," },
  PgProgramInfo: { update: mocks.update, onDidChangeIdl: "idl" },
}));
vi.mock("../../../hooks", () => ({
  useRenderOnChange: () => mocks.idl,
}));
vi.mock("@/shared/lib/logger", () => ({
  createLogger: () => ({
    warn: mocks.warn,
    error: mocks.error,
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import IdlActions from "./IdlActions";

const COUNTER_IDL = JSON.stringify({ name: "counter", instructions: [] });

const jsonFile = (text: string, name = "idl.json") =>
  new File([text], name, { type: "application/json" });

const pick = (container: HTMLElement, file: File) =>
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });

afterEach(() => {
  mocks.idl = null;
  mocks.update.mockReset();
  vi.clearAllMocks();
});

describe("IdlActions", () => {
  /** The prototype's secondary action, a button rather than a drop zone */
  it("offers Upload IDL, which says nothing reaches the chain", () => {
    const { container } = render(<IdlActions mode="upload" />);

    expect(container.querySelector('[data-slot="drop-zone"]')).toBeNull();
    const button = screen.getByRole("button", { name: "Upload IDL" });
    expect(button.getAttribute("title")).toBe(
      "Replaces the IDL this browser uses in Interact \u2014 nothing is written on-chain"
    );
  });

  it("uses an IDL picked through it", async () => {
    const { container } = render(<IdlActions mode="upload" />);

    pick(container, jsonFile(COUNTER_IDL));

    expect(await screen.findByText("Using counter")).toBeTruthy();
    expect(mocks.update).toHaveBeenCalledWith({
      idl: { name: "counter", instructions: [] },
    });
  });

  it("refuses a file that is not JSON, and logs it", async () => {
    const { container } = render(<IdlActions mode="upload" />);

    pick(container, jsonFile("not json", "notes.txt"));

    expect(await screen.findByText("Not an Anchor IDL JSON file")).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("refuses JSON without instructions", async () => {
    const { container } = render(<IdlActions mode="upload" />);

    pick(container, jsonFile(JSON.stringify({ name: "x" })));

    expect(await screen.findByText("Not an Anchor IDL JSON file")).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("holds Download IDL until a build produced one", () => {
    render(<IdlActions mode="download" />);

    const button = screen.getByRole("button", { name: "Download IDL" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("title")).toBe("Build successfully first");
  });

  it("downloads the IDL a build produced", () => {
    mocks.idl = { name: "counter", instructions: [] };
    render(<IdlActions mode="download" />);

    const link = screen.getByRole("link", { name: "Download IDL" });
    expect(link.getAttribute("download")).toBe("idl.json");
  });

  /** A throw past the checks is ours, not the user's file's */
  it("does not blame the file for a failure after it was accepted", async () => {
    mocks.update.mockImplementation(() => {
      throw new Error("listener broke");
    });
    const { container } = render(<IdlActions mode="upload" />);

    pick(container, jsonFile(COUNTER_IDL));

    // `ImportButton` reports it, through `reportButtonFailure`'s logger
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(expect.any(Error))
    );
    expect(screen.queryByText("Not an Anchor IDL JSON file")).toBeNull();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  /**
   * A browser fires no change for the file the input already holds, so a
   * file fixed on disk and picked again would be ignored unless the input
   * lets go of it after each pick.
   */
  it("takes the same file picked again", async () => {
    const { container } = render(<IdlActions mode="upload" />);
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const cleared = vi.fn();
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: cleared,
    });

    fireEvent.change(input, { target: { files: [jsonFile("not json")] } });

    expect(await screen.findByText("Not an Anchor IDL JSON file")).toBeTruthy();
    expect(cleared).toHaveBeenCalledWith("");
  });
});
