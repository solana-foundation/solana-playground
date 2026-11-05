import { beforeEach, describe, expect, it, vi } from "vitest";
// The Interact body: a card per instruction, each folding on its own, a
// call's result under the card that made it for the program and network it
// went to, and the history beside them.
const h = vi.hoisted(() => ({ runCall: vi.fn(), inFlight: false }));

vi.mock("./run-call", () => ({
  runCall: h.runCall,
  useCallInFlight: () => h.inFlight,
}));
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
    solNeededOn?: string;
    callBlocked?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div data-testid={`card ${p.idlInstruction.name}`}>
      <button
        aria-expanded={!!p.open}
        onClick={() => p.onOpenChange?.(!p.open)}
      >
        {p.idlInstruction.name}
      </button>
      {p.open && (
        <>
          <p>form {p.idlInstruction.name}</p>
          {p.feePayer}
          {p.solNeededOn && <p>held for {p.solNeededOn}</p>}
          <button
            disabled={p.callBlocked}
            onClick={() => p.onCall({ name: p.idlInstruction.name })}
          >
            Test {p.idlInstruction.name}
          </button>
        </>
      )}
    </div>
  ),
}));
vi.mock("../../sidebar/test/Component/Account", () => ({
  default: () => undefined,
}));
vi.mock("../../sidebar/test/Component/Event", () => ({
  default: () => undefined,
}));

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { TooltipProvider } from "@/shared/ui/tooltip";

import type { InteractBodyProps } from "./InteractBody";
import InteractBody from "./InteractBody";

type Idl = InteractBodyProps["idl"];

const idl = (...names: string[]) =>
  ({
    version: "0.1.0",
    name: "counter",
    instructions: names.map((name) => ({ name, accounts: [], args: [] })),
  } as unknown as Idl);

const wrap = (ui: ReactElement) => <TooltipProvider>{ui}</TooltipProvider>;

const scrolled = vi.fn();
beforeEach(() => {
  localStorage.clear();
  h.runCall.mockReset();
  h.inFlight = false;
  scrolled.mockReset();
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled(this);
  };
});

const expanded = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-expanded");

const record = (instruction: string) =>
  localStorage.setItem(
    "flow.calls",
    JSON.stringify([
      {
        id: "a",
        programId: "P",
        cluster: "devnet",
        instruction,
        ok: true,
        signature: "sig",
        // eslint-disable-next-line unicorn/no-null -- a stored record writes a missing failing line as null
        failingLine: null,
        at: 1,
      },
    ])
  );

describe("InteractBody", () => {
  it("offers no Test while another call is in flight, on any card", () => {
    h.inFlight = true;
    render(
      wrap(
        <InteractBody
          idl={idl("initialize", "increment")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    for (const name of ["initialize", "increment"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: `Test ${name}` })
          .disabled
      ).toBe(true);
    }
  });

  it("draws a card per instruction, no chips, every card folded on arrival", () => {
    render(
      wrap(
        <InteractBody
          idl={idl("initialize", "increment")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    expect(screen.queryByRole("radio")).toBeNull();
    expect(expanded("initialize")).toBe("false");
    expect(expanded("increment")).toBe("false");
    expect(screen.queryByText(/^form /)).toBeNull();
  });

  it("folds each card on its own, so two may be open", () => {
    render(
      wrap(
        <InteractBody
          idl={idl("initialize", "increment")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "initialize" }));
    fireEvent.click(screen.getByRole("button", { name: "increment" }));
    expect(screen.getByText("form initialize")).toBeTruthy();
    expect(screen.getByText("form increment")).toBeTruthy();
    expect(
      screen.getAllByText("Fee payer · Playground wallet · 0.5 SOL")
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "initialize" }));
    expect(screen.queryByText("form initialize")).toBeNull();
    expect(screen.getByText("form increment")).toBeTruthy();
  });

  it("keeps an open card open across a rebuilt IDL that still has it", () => {
    const { rerender } = render(
      wrap(
        <InteractBody
          idl={idl("initialize", "increment")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "increment" }));
    rerender(
      wrap(
        <InteractBody
          idl={idl("increment", "reset")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    expect(screen.getByText("form increment")).toBeTruthy();
  });

  it("tells every card the network whose SOL the fee needs", () => {
    render(
      wrap(
        <InteractBody
          idl={idl("initialize")}
          programId="P"
          cluster="devnet"
          solNeededOn="devnet"
        />
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "initialize" }));
    expect(screen.getByText("held for devnet")).toBeTruthy();
  });

  it("puts the result right under the card that made the call", async () => {
    h.runCall.mockResolvedValue({
      instruction: "increment",
      ok: true,
      signature: "sig",
      logs: [],
      failingLine: undefined,
    });
    render(
      wrap(
        <InteractBody
          idl={idl("initialize", "increment", "reset")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "increment" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test increment" }));
    });
    const result = screen.getByRole("region", { name: "Call result" });
    // The card sits in a wrapper the history scrolls to; the result follows it
    const card = screen.getByTestId("card increment").parentElement;
    expect(card?.nextElementSibling).toBe(result);

    // Folding the card keeps its result in place
    fireEvent.click(screen.getByRole("button", { name: "increment" }));
    expect(card?.nextElementSibling).toBe(
      screen.getByRole("region", { name: "Call result" })
    );
  });

  it("shows a call's result and history only for the program and network it went to", async () => {
    h.runCall.mockResolvedValue({
      instruction: "initialize",
      ok: true,
      signature: "sig",
      logs: [],
      failingLine: undefined,
    });
    const { rerender } = render(
      wrap(
        <InteractBody idl={idl("initialize")} programId="P" cluster="devnet" />
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "initialize" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test initialize" }));
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

  it("keeps each card's own result when two tests settle out of order", async () => {
    const settle: Record<string, (o: unknown) => void> = {};
    h.runCall.mockImplementation(
      (ix: { name: string }) =>
        new Promise((resolve) => (settle[ix.name] = resolve))
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
    fireEvent.click(screen.getByRole("button", { name: "initialize" }));
    fireEvent.click(screen.getByRole("button", { name: "increment" }));
    fireEvent.click(screen.getByRole("button", { name: "Test initialize" }));
    fireEvent.click(screen.getByRole("button", { name: "Test increment" }));
    const outcome = (instruction: string) => ({
      instruction,
      ok: true,
      signature: `sig-${instruction}`,
      logs: [],
      failingLine: undefined,
    });
    await act(async () => settle.increment(outcome("increment")));
    await act(async () => settle.initialize(outcome("initialize")));

    expect(screen.getAllByRole("region", { name: "Call result" })).toHaveLength(
      2
    );
    for (const name of ["initialize", "increment"]) {
      const result = screen.getByTestId(`card ${name}`).parentElement
        ?.nextElementSibling;
      expect(result?.textContent).toContain(name);
    }
  });

  it("keeps a Call history column beside the cards before the first call", () => {
    render(
      wrap(
        <InteractBody idl={idl("initialize")} programId="P" cluster="devnet" />
      )
    );
    const history = screen.getByRole("region", { name: "Call history" });
    expect(history.textContent).toContain("No calls yet");
    const columns = history.closest("[data-slot='interact-columns']");
    expect(columns).not.toBeNull();
    expect(columns?.contains(screen.getByTestId("card initialize"))).toBe(true);
    // One column shows no history before the first call
    expect(history.className).toContain("@max-[40rem]:hidden");
  });

  it("keeps a populated history in the column, shown at every width, and its rows open their card", () => {
    record("increment");
    render(
      wrap(
        <InteractBody
          idl={idl("initialize", "increment")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    const history = screen.getByRole("region", { name: "Call history" });
    expect(history.closest("[data-slot='interact-columns']")).not.toBeNull();
    expect(history.className).not.toContain("@max-[40rem]:hidden");

    fireEvent.click(screen.getByRole("button", { name: "initialize" }));
    fireEvent.click(screen.getByRole("button", { name: "Open increment" }));
    expect(screen.getByText("form increment")).toBeTruthy();
    // The other open card stays as it was
    expect(screen.getByText("form initialize")).toBeTruthy();
    expect(scrolled).toHaveBeenCalledWith(
      screen.getByTestId("card increment").parentElement
    );
  });

  it("puts Accounts and Events below the columns, full width", () => {
    const withAccounts = {
      version: "0.1.0",
      name: "counter",
      instructions: [{ name: "initialize", accounts: [], args: [] }],
      accounts: [{ name: "Counter" }],
      events: [{ name: "Bumped" }],
    } as unknown as Idl;
    render(
      wrap(<InteractBody idl={withAccounts} programId="P" cluster="devnet" />)
    );
    const columns = screen
      .getByRole("region", { name: "Call history" })
      .closest("[data-slot='interact-columns']");
    for (const title of ["Accounts", "Events"]) {
      const heading = screen.getByRole("heading", { name: title });
      expect(columns?.contains(heading)).toBe(false);
    }
  });

  it("a history row of an instruction the IDL lost leaves the cards alone", () => {
    record("removed");
    render(
      wrap(
        <InteractBody
          idl={idl("initialize", "increment")}
          programId="P"
          cluster="devnet"
        />
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Open removed" }));
    expect(expanded("initialize")).toBe("false");
    expect(expanded("increment")).toBe("false");
    expect(scrolled).not.toHaveBeenCalled();
  });
});
