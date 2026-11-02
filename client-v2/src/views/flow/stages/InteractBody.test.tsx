// The Interact body: chips pick one instruction's form, a call's result shows
// under it for the program and network it went to, and the history lists.
const h = vi.hoisted(() => ({ runCall: vi.fn() }));

vi.mock("./run-call", () => ({ runCall: h.runCall }));
vi.mock("../../../utils", () => ({
  PgProgramInfo: { onDidChangeIdl: () => ({ dispose: () => {} }) },
}));
vi.mock("../../../utils/program-interaction", () => ({
  PgProgramInteraction: { syncAllInstructions: vi.fn() },
}));
vi.mock("../../../hooks", () => ({
  useBalance: () => 0.5,
  useBlockExplorer: () => ({ getTxUrl: (s: string) => `https://x/tx/${s}` }),
  useWallet: () => ({ isPg: true, name: "Wallet 1" }),
}));
vi.mock("../../sidebar/test/Component/Instruction", () => ({
  default: (p: {
    idlInstruction: { name: string };
    onCall: (ix: { name: string }) => Promise<unknown>;
    feePayer: ReactNode;
  }) => (
    <div>
      <p>form {p.idlInstruction.name}</p>
      {p.feePayer}
      <button onClick={() => p.onCall({ name: p.idlInstruction.name })}>
        Call {p.idlInstruction.name}
      </button>
    </div>
  ),
}));
vi.mock("../../sidebar/test/Component/Account", () => ({
  default: () => null,
}));
vi.mock("../../sidebar/test/Component/Event", () => ({ default: () => null }));

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import InteractBody from "./InteractBody";
import type { InteractBodyProps } from "./InteractBody";

type Idl = InteractBodyProps["idl"];

const idl = (...names: string[]) =>
  ({
    version: "0.1.0",
    name: "counter",
    instructions: names.map((name) => ({ name, accounts: [], args: [] })),
  } as unknown as Idl);

const wrap = (ui: ReactElement) => <TooltipProvider>{ui}</TooltipProvider>;

// The chips measure their current item to place the indicator
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

beforeEach(() => {
  localStorage.clear();
  h.runCall.mockReset();
});

describe("InteractBody", () => {
  it("picks the first instruction and draws only its form", () => {
    render(
      wrap(
        <InteractBody
          idl={idl("initialize", "increment")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    expect(
      screen
        .getByRole("radio", { name: "initialize" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(screen.getByText("form initialize")).toBeTruthy();
    expect(screen.queryByText("form increment")).toBeNull();
    expect(
      screen.getByText("Fee paid by Playground wallet · 0.5 SOL")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "increment" }));
    expect(screen.getByText("form increment")).toBeTruthy();
    expect(screen.queryByText("form initialize")).toBeNull();
  });

  it("falls back to the first instruction when the picked one leaves the IDL", () => {
    const { rerender } = render(
      wrap(
        <InteractBody
          idl={idl("initialize", "increment")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    fireEvent.click(screen.getByRole("radio", { name: "increment" }));
    rerender(
      wrap(
        <InteractBody
          idl={idl("initialize", "reset")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    expect(screen.getByText("form initialize")).toBeTruthy();
  });

  it("shows a call's result and history only for the program and network it went to", async () => {
    h.runCall.mockResolvedValue({
      instruction: "initialize",
      ok: true,
      signature: "sig",
      logs: [],
      failingLine: null,
    });
    const { rerender } = render(
      wrap(
        <InteractBody idl={idl("initialize")} programId="P" cluster="devnet" />
      )
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Call initialize" }));
    });
    expect(
      screen.getByRole("region", { name: "Call result" }).textContent
    ).toContain("Succeeded");

    rerender(
      wrap(
        <InteractBody idl={idl("initialize")} programId="P" cluster="testnet" />
      )
    );
    expect(screen.queryByRole("region", { name: "Call result" })).toBeNull();
  });

  it("a history row of an instruction the IDL lost leaves the form alone", () => {
    localStorage.setItem(
      "flow.calls",
      JSON.stringify([
        {
          id: "a",
          programId: "P",
          cluster: "devnet",
          instruction: "removed",
          ok: true,
          signature: "sig",
          failingLine: null,
          at: 1,
        },
      ])
    );
    render(
      wrap(
        <InteractBody
          idl={idl("initialize", "increment")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    fireEvent.click(screen.getByRole("radio", { name: "increment" }));
    fireEvent.click(screen.getByRole("button", { name: "Open removed" }));
    expect(screen.getByText("form increment")).toBeTruthy();
  });
});
