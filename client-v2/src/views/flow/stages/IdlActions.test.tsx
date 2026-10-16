// The IDL's two doors: download what the build produced, and load a file
// into the browser by dropping or picking it.
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

const dropOn = (zone: Element, file: File) =>
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });

const zone = (container: HTMLElement) =>
  container.querySelector('[data-slot="drop-zone"]')!;

afterEach(() => {
  mocks.idl = null;
  mocks.update.mockReset();
  vi.clearAllMocks();
});

describe("IdlActions", () => {
  it("offers a drop zone that says nothing reaches the chain", () => {
    const { container } = render(<IdlActions mode="drop" />);

    expect(zone(container)).toBeTruthy();
    expect(screen.getByText("Load IDL file")).toBeTruthy();
    expect(
      screen.getByText(
        "Replaces the IDL this browser uses in Interact -- nothing is written on-chain"
      )
    ).toBeTruthy();
  });

  it("uses an IDL dropped on it", async () => {
    const { container } = render(<IdlActions mode="drop" />);

    dropOn(zone(container), jsonFile(COUNTER_IDL));

    expect(await screen.findByText("Using counter")).toBeTruthy();
    expect(mocks.update).toHaveBeenCalledWith({
      idl: { name: "counter", instructions: [] },
    });
  });

  it("uses an IDL picked through it", async () => {
    const { container } = render(<IdlActions mode="drop" />);
    const input = container.querySelector('input[type="file"]')!;

    fireEvent.change(input, { target: { files: [jsonFile(COUNTER_IDL)] } });

    expect(await screen.findByText("Using counter")).toBeTruthy();
  });

  it("refuses a file that is not JSON, and logs it", async () => {
    const { container } = render(<IdlActions mode="drop" />);

    dropOn(zone(container), jsonFile("not json", "notes.txt"));

    expect(await screen.findByText("Not an Anchor IDL JSON file")).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("refuses JSON without instructions", async () => {
    const { container } = render(<IdlActions mode="drop" />);

    dropOn(zone(container), jsonFile(JSON.stringify({ name: "x" })));

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
    const { container } = render(<IdlActions mode="drop" />);

    dropOn(zone(container), jsonFile(COUNTER_IDL));

    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(expect.any(Error), {
        report: true,
      })
    );
    expect(screen.queryByText("Not an Anchor IDL JSON file")).toBeNull();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  /** Interact's toolbar has room for a button, not a drop zone */
  it("offers a compact button where a toolbar asks for one", async () => {
    const { container } = render(<IdlActions mode="button" />);

    expect(container.querySelector('[data-slot="drop-zone"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Load IDL file" })).toBeTruthy();
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [jsonFile(COUNTER_IDL)] },
    });
    expect(await screen.findByText("Using counter")).toBeTruthy();
  });

  /**
   * A browser fires no change for the file the input already holds, so a
   * file fixed on disk and picked again would be ignored unless the input
   * lets go of it after each pick.
   */
  it("takes the same file picked again", async () => {
    const { container } = render(<IdlActions mode="drop" />);
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
