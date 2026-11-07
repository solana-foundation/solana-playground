import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { CallView, RunResult } from "@/features/tutorial-conversation";
import { TooltipProvider } from "@/shared/ui/tooltip";

import type { BaseCallPanelProps } from "./BaseCallPanel";
import BaseCallPanel from "./BaseCallPanel";

const view = (over: Partial<CallView>): CallView => ({
  program: "hello_anchor",
  instruction: over.instruction ?? "hello",
  chips: over.chips ?? [],
  signature: over.signature ?? "()",
  code: over.code ?? "pg.program.methods.hello().rpc()",
  fields: over.fields ?? [],
  note: over.note,
  canCall: over.canCall ?? true,
  canRecheck: over.canRecheck ?? false,
  calling: over.calling ?? false,
  json: '{ "name": "hello_anchor" }',
  result: over.result,
  stale: over.stale,
});

const NAME = {
  name: "name",
  type: "string",
  value: "",
  isNew: true,
  numeric: false,
  max: 32,
};

const landed: RunResult = {
  act: "call",
  ok: true,
  seconds: 1,
  signatures: ["5igSig"],
  line: "Program log: Hello, Ada!",
  called: [{ instruction: "hello", args: { name: "Ada" } }],
  receipt: { computeUnits: 1187, fee: 5000, log: ["Program log: Hello, Ada!"] },
};

const panel = (props: Partial<BaseCallPanelProps>) => {
  const on = {
    onTab: vi.fn(),
    onPick: vi.fn(),
    onType: vi.fn(),
    onCall: vi.fn(),
    onRecheck: vi.fn(),
  };
  render(
    <TooltipProvider>
      <BaseCallPanel view={view({})} tab="form" {...on} {...props} />
    </TooltipProvider>
  );
  return on;
};

const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
});

describe("BaseCallPanel", () => {
  it("shows the upgrade's field with New, and one call button", () => {
    panel({
      view: view({ signature: "(name: string)", fields: [NAME] }),
    });
    const field = screen.getByRole("textbox", { name: "name, string" });
    expect(field.getAttribute("maxLength")).toBe("32");
    expect(screen.getByText("New")).toBeTruthy();
    expect(button("Call hello").disabled).toBe(false);
  });

  it("shows no field for an instruction without arguments", () => {
    panel({});
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("New")).toBeNull();
  });

  it("lists several instructions as chips over one form and one button", async () => {
    const { onPick } = panel({
      view: view({
        instruction: "second",
        chips: ["first", "second", "third"].map((name) => ({
          name,
          isNew: false,
        })),
      }),
    });
    const group = screen.getByRole("radiogroup", { name: "Instruction" });
    const chips = within(group).getAllByRole("radio");
    expect(chips.map((c) => c.textContent)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(
      within(group)
        .getByRole("radio", { name: "second" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(screen.getAllByRole("button", { name: /^Call / })).toHaveLength(1);
    await userEvent.click(within(group).getByRole("radio", { name: "third" }));
    expect(onPick).toHaveBeenCalledWith("third");
  });

  it("calls on Enter only when the call can go", async () => {
    const ready = panel({ view: view({ fields: [NAME] }) });
    await userEvent.type(screen.getByRole("textbox"), "{Enter}");
    expect(ready.onCall).toHaveBeenCalledTimes(1);
  });

  it("does not call on Enter while Call is off", async () => {
    const off = panel({ view: view({ fields: [NAME], canCall: false }) });
    await userEvent.type(screen.getByRole("textbox"), "{Enter}");
    expect(off.onCall).not.toHaveBeenCalled();
    expect(button("Call hello").disabled).toBe(true);
  });

  it("shows a call devnet has not read back as pending, with Check again", async () => {
    const unconfirmed: RunResult = {
      act: "call",
      ok: false,
      seconds: 1,
      reason: "unconfirmed",
      message: "Devnet has not confirmed this transaction yet.",
      log: "",
      unconfirmed: [{ signature: "5igSig", calls: [] }],
    };
    const { onRecheck } = panel({
      view: view({ result: unconfirmed, canCall: false, canRecheck: true }),
    });
    expect(screen.getByText("Not confirmed yet")).toBeTruthy();
    expect(screen.queryByText("Failed")).toBeNull();
    expect(button("Call hello").disabled).toBe(true);
    await userEvent.click(button("Check again"));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("says Sending and Calling while a call goes", () => {
    panel({ view: view({ calling: true, canCall: false, result: landed }) });
    expect(screen.getByText("Sending")).toBeTruthy();
    expect(button("Calling").disabled).toBe(true);
    expect(screen.queryByText("Confirmed")).toBeNull();
  });

  it("shows the result alone, with the fee and a quiet Explorer", () => {
    panel({ view: view({ result: landed }) });
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("Program log: Hello, Ada!")).toBeTruthy();
    expect(
      screen.getByText(
        "The call used 1,187 compute units, and the fee was 0.000005 test SOL from your wallet."
      )
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Explorer" }).getAttribute("href")
    ).toContain("5igSig");
    // The request above names the call: the result does not again
    const response = screen.getByRole("region", { name: "Response" });
    expect(within(response).queryByText("hello")).toBeNull();
  });

  it("dims a result the fields moved on from, saying what it was sent with", () => {
    panel({
      view: view({ result: landed, stale: 'Last call, with name "Ada"' }),
    });
    expect(screen.getByText('Last call, with name "Ada"')).toBeTruthy();
    expect(screen.getByText("Confirmed").closest(".opacity-60")).not.toBeNull();
  });

  it("shows a failed call's reason in red", () => {
    panel({
      view: view({
        result: {
          act: "call",
          ok: false,
          seconds: 1,
          message: "Not enough energy",
          log: "",
        },
      }),
    });
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("Not enough energy").className).toContain(
      "text-error"
    );
  });

  it("says why Call is off, over it", () => {
    panel({
      view: view({ note: "needs `map`", canCall: false }),
    });
    const id = button("Call hello").getAttribute("aria-describedby");
    expect(document.getElementById(id ?? "")?.textContent).toBe("needs `map`");
  });

  it("swaps the form for the IDL's JSON, read only", async () => {
    const { onTab } = panel({});
    await userEvent.click(screen.getByRole("radio", { name: "IDL" }));
    expect(onTab).toHaveBeenCalledWith("idl");
  });

  it("shows the JSON on the IDL tab, with Copy", () => {
    panel({ tab: "idl" });
    expect(screen.getByLabelText("IDL JSON, read only").textContent).toContain(
      "hello_anchor"
    );
    expect(screen.getByRole("button", { name: "Copy IDL" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Call / })).toBeNull();
  });

  it("has nothing to call before a deploy", () => {
    panel({ view: undefined });
    expect(screen.getByText("Nothing to call yet")).toBeTruthy();
  });
});
