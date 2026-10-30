import type { ChangeEvent, ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as reportModule from "@/shared/lib/report-button-failure";

import ImportButton from ".";

afterEach(() => vi.restoreAllMocks());

describe("ImportButton", () => {
  it("opens the file picker and names the chosen file", async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <ImportButton onImport={onImport} showImportText>
        Import
      </ImportButton>
    );
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const click = vi.spyOn(input, "click");

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(click).toHaveBeenCalled();

    const file = new File(["{}"], "idl.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onImport).toHaveBeenCalled();
    expect(await screen.findByText("idl.json")).toBeTruthy();
  });

  it("is a design-system button", () => {
    render(<ImportButton onImport={vi.fn()}>Import</ImportButton>);
    expect(screen.getByRole("button").getAttribute("data-slot")).toBe("button");
  });

  it("forgets the last imported name when the next import fails", async () => {
    const failure = new Error("bad idl");
    const onImport = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);
    const report = vi.fn();
    const reportFor = vi
      .spyOn(reportModule, "reportButtonFailure")
      .mockReturnValue(report);
    const { container } = renderImport(onImport);
    const input = fileInput(container);

    fireEvent.change(input, { target: { files: [jsonFile("first.json")] } });
    expect(await screen.findByText("first.json")).toBeTruthy();
    fireEvent.change(input, { target: { files: [jsonFile("second.json")] } });

    await waitFor(() => expect(report).toHaveBeenCalledWith(failure));
    expect(reportFor).toHaveBeenCalledWith("import the file");
    expect(screen.queryByText("first.json")).toBeNull();
    expect(screen.queryByText("second.json")).toBeNull();
  });

  it("lets the same file be picked again after a failed import", async () => {
    vi.spyOn(reportModule, "reportButtonFailure").mockReturnValue(vi.fn());
    const { container } = renderImport(
      vi.fn().mockRejectedValue(new Error("bad idl"))
    );
    const input = fileInput(container);
    const setValue = vi.fn();
    Object.defineProperty(input, "value", { get: () => "", set: setValue });

    fireEvent.change(input, { target: { files: [jsonFile("idl.json")] } });

    await waitFor(() => expect(setValue).toHaveBeenCalledWith(""));
  });

  it("names the chosen file even when the import clears the input", async () => {
    const onImport = vi.fn(async (ev: ChangeEvent<HTMLInputElement>) => {
      // what a reset of the input's value does to its file list
      Object.defineProperty(ev.target, "files", { value: null });
    });
    const { container } = renderImport(onImport);

    fireEvent.change(fileInput(container), {
      target: { files: [jsonFile("keypair.json")] },
    });

    expect(await screen.findByText("keypair.json")).toBeTruthy();
  });
});

const renderImport = (
  onImport: ComponentProps<typeof ImportButton>["onImport"]
) =>
  render(
    <ImportButton onImport={onImport} showImportText>
      Import
    </ImportButton>
  );

const fileInput = (container: HTMLElement) =>
  container.querySelector('input[type="file"]') as HTMLInputElement;

const jsonFile = (name: string) =>
  new File(["{}"], name, { type: "application/json" });
