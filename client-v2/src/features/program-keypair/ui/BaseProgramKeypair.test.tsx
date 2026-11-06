// The program id block drawn from props: the fold, the field, the five
// actions, the dialog, the mismatch warning and the refusal line.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";

import type {
  BaseProgramKeypairProps,
  KeypairNote,
} from "./BaseProgramKeypair";
import BaseProgramKeypair from "./BaseProgramKeypair";

const ID = "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj";
const OTHER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

interface Shape {
  open?: boolean;
  hasKeypair?: boolean;
  customId?: boolean;
  mismatch?: boolean;
  note?: KeypairNote;
  confirming?: boolean;
  held?: boolean;
}

const props = (s: Shape): BaseProgramKeypairProps => ({
  programId: ID,
  hasKeypair: s.hasKeypair ?? true,
  customId: s.customId ?? false,
  mismatch: s.mismatch ?? false,
  note: s.note,
  open: s.open ?? true,
  onOpenChange: vi.fn(),
  confirming: s.confirming ?? false,
  replacing: "new",
  held: s.held ?? false,
  onNew: vi.fn(),
  onConfirmNew: vi.fn(),
  onCancelNew: vi.fn(),
  onSaveOld: vi.fn(),
  onImport: vi.fn(),
  onExport: vi.fn(),
  onEdit: vi.fn(),
  onChangeId: vi.fn(),
  onRemoveCustomId: vi.fn(),
});

const fileInput = () => {
  const input = screen
    .getByText("Drop a program keypair here")
    .closest("label")
    ?.querySelector("input");
  if (!input) throw new Error("the keypair drop zone has no file input");
  return input;
};

const draw = (p: BaseProgramKeypairProps) =>
  render(
    <TooltipProvider>
      <BaseProgramKeypair {...p} />
    </TooltipProvider>
  );

const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("features/program-keypair/ui/BaseProgramKeypair", () => {
  it("holds everything that changes the id while a deploy runs", () => {
    draw(props({ held: true, customId: true }));

    const field = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Program id",
    });
    expect(field.disabled).toBe(true);
    for (const name of ["New keypair", "Remove custom id"]) {
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name }).disabled
      ).toBe(true);
    }
    expect(fileInput().disabled).toBe(true);
  });

  it("closes the New keypair question when a deploy starts", () => {
    draw(props({ held: true, confirming: true }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows only the fold's trigger while closed", () => {
    const p = props({ open: false });
    draw(p);

    expect(screen.getByRole("region", { name: "Program id" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Program id" })).toBeNull();
    press("Program id");
    expect(p.onOpenChange).toHaveBeenCalledWith(true);
  });

  it("shows the id, its copy button and the hint when open", () => {
    draw(props({}));

    const field = screen.getByRole("textbox", { name: "Program id" });
    expect((field as HTMLInputElement).value).toBe(ID);
    expect(
      screen.getByRole("button", { name: "Copy the program id" })
    ).toBeTruthy();
    expect(
      screen.getByText("Only the upgrade authority can upgrade the program.")
    ).toBeTruthy();
  });

  it("asks for a new keypair through onNew", () => {
    const p = props({});
    draw(p);
    press("New keypair");
    expect(p.onNew).toHaveBeenCalledTimes(1);
  });

  it("asks before replacing a keypair, with the legacy copy", () => {
    const p = props({ confirming: true });
    draw(p);

    expect(
      screen.getByRole("dialog", {
        name: "Create a new program keypair?",
      })
    ).toBeTruthy();
    expect(
      screen.getByText("This will create a brand new keypair for your program.")
    ).toBeTruthy();
    expect(
      screen.getByText("The old keypair will be lost if you don't save it.")
    ).toBeTruthy();
    press("Save keypair");
    expect(p.onSaveOld).toHaveBeenCalledTimes(1);
    press("Generate");
    expect(p.onConfirmNew).toHaveBeenCalledTimes(1);
  });

  it("cancels the dialog on Escape, never confirms it", () => {
    const p = props({ confirming: true });
    draw(p);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(p.onCancelNew).toHaveBeenCalledTimes(1);
    expect(p.onConfirmNew).not.toHaveBeenCalled();
  });

  it("hands a dropped file to onImport", () => {
    const p = props({});
    draw(p);
    const file = new File(["[]"], "program-keypair.json");
    fireEvent.drop(screen.getByLabelText("Import keypair"), {
      dataTransfer: { files: [file] },
    });
    expect(p.onImport).toHaveBeenCalledWith(file);
  });

  it("hands a picked file to onImport", () => {
    const p = props({});
    draw(p);
    const file = new File(["[]"], "program-keypair.json");
    const input = fileInput();
    fireEvent.change(input, { target: { files: [file] } });
    expect(p.onImport).toHaveBeenCalledWith(file);
  });

  it("exports the keypair, and hides Export with none or a custom id", () => {
    const p = props({});
    const { unmount } = draw(p);
    press("Export keypair");
    expect(p.onExport).toHaveBeenCalledTimes(1);
    unmount();

    draw(props({ hasKeypair: false }));
    expect(screen.queryByRole("button", { name: "Export keypair" })).toBeNull();
  });

  it("hides Export while a custom id is set", () => {
    draw(props({ customId: true }));
    expect(screen.queryByRole("button", { name: "Export keypair" })).toBeNull();
  });

  it("offers Change program id once the text differs, trimmed", () => {
    const p = props({});
    draw(p);
    expect(
      screen.queryByRole("button", { name: "Change program id" })
    ).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Program id" }), {
      target: { value: `  ${OTHER} ` },
    });
    press("Change program id");
    expect(p.onChangeId).toHaveBeenCalledWith(OTHER);
  });

  it("removes a custom id, offered only while one is set", () => {
    const { unmount } = draw(props({}));
    expect(
      screen.queryByRole("button", { name: "Remove custom id" })
    ).toBeNull();
    unmount();

    const p = props({ customId: true });
    draw(p);
    press("Remove custom id");
    expect(p.onRemoveCustomId).toHaveBeenCalledTimes(1);
  });

  it("warns when the custom id does not match the keypair", () => {
    draw(props({ customId: true, mismatch: true }));
    expect(
      screen.getByText(/This program id does not match the program keypair/)
    ).toBeTruthy();
  });

  it("keeps the green note away from the mismatch warning", () => {
    draw(props({ note: "changed", customId: true, mismatch: true }));
    expect(screen.queryByText("Program id changed")).toBeNull();
  });

  it("puts Remove custom id in the keypair row, as quiet as the rest", () => {
    draw(props({ customId: true }));
    const remove = screen.getByRole("button", { name: "Remove custom id" });
    const create = screen.getByRole("button", { name: "New keypair" });
    expect(remove.parentElement).toBe(create.parentElement);
  });

  it("reports an edit, so the container can drop a stale note", () => {
    const p = props({ note: "invalid" });
    draw(p);
    fireEvent.change(screen.getByRole("textbox", { name: "Program id" }), {
      target: { value: "abcd" },
    });
    expect(p.onEdit).toHaveBeenCalled();
  });

  it.each([
    ["changed", "Program id changed"],
    ["invalid", "Not a valid public key"],
    ["removed", "Custom id removed"],
    [
      "refused",
      "That file is not a program keypair: expected the 64-number JSON the Solana CLI writes.",
    ],
  ] as const)("says %s", (note, text) => {
    draw(props({ note }));
    expect(screen.getByText(text)).toBeTruthy();
  });
});
