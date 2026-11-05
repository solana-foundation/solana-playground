import { afterEach, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ hold: undefined as string | undefined }));
vi.mock("@/widgets/status", () => ({ useNetworkHold: () => network.hold }));

// The utils barrel reads build-time globals jsdom lacks, and the inputs need
// a connected program; the form under test needs none of it.
vi.mock("../../../../../utils", () => ({
  PgCommon: { debounce: (fn: () => void) => fn },
}));
// What the store holds for an instruction: a filled form the user left and
// came back to, or an empty custom field, or a field with a parse error
const stored = vi.hoisted(() => ({
  amount: { value: "5", error: false },
}));
vi.mock("../../../../../utils/program-interaction", () => ({
  PgProgramInteraction: {
    getOrCreateInstruction: (ix: { name: string }) => ({
      name: ix.name,
      values: {
        args: [
          {
            name: "amount",
            error: stored.amount.error,
            generator: { type: "Custom", value: stored.amount.value },
          },
        ],
        accounts: [
          {
            name: "owner",
            error: false,
            generator: { type: "Custom", value: "owner-key" },
          },
        ],
      },
    }),
    saveInstruction: vi.fn(),
  },
}));
const wallet = vi.hoisted(() => ({ current: {} as object | undefined }));
vi.mock("../../../../../hooks", () => ({ useWallet: () => wallet.current }));
vi.mock("./InstructionInput", () => ({ default: () => null }));
vi.mock("../IdlProvider", () => ({ useIdl: () => ({ idl: {} }) }));

import { act, fireEvent, render, screen } from "@testing-library/react";

import Instruction from "./Instruction";

type Props = Parameters<typeof Instruction>[0];

const IX = {
  name: "increment",
  args: [],
  accounts: [],
} as unknown as Props["idlInstruction"];

it("starts with the Args and Accounts folds open", () => {
  render(<Instruction idlInstruction={IX} onCall={vi.fn()} />);

  expect(
    screen.getByRole("button", { name: "Args" }).getAttribute("aria-expanded")
  ).toBe("true");
  expect(
    screen
      .getByRole("button", { name: "Accounts" })
      .getAttribute("aria-expanded")
  ).toBe("true");
});

it("calls the instruction through onCall from a button named after it", () => {
  const onCall = vi.fn(() => Promise.resolve());
  render(<Instruction idlInstruction={IX} onCall={onCall} />);

  fireEvent.click(screen.getByRole("button", { name: "Call increment" }));
  expect(onCall).toHaveBeenCalledWith(
    expect.objectContaining({ name: "increment" })
  );
});

it("keeps Call off while the caller blocks it", () => {
  render(<Instruction idlInstruction={IX} onCall={vi.fn()} callBlocked />);

  expect(
    (
      screen.getByRole("button", {
        name: "Call increment",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
});

it("draws the fee payer slot above the actions", () => {
  render(
    <Instruction
      idlInstruction={IX}
      onCall={vi.fn()}
      feePayer={<p>Fee paid by Playground wallet · 1 SOL</p>}
    />
  );
  expect(
    screen.getByText("Fee paid by Playground wallet · 1 SOL")
  ).toBeTruthy();
});

it("reads Calling… and locks the form until the call settles", async () => {
  let settle: () => void = () => {};
  const onCall = vi.fn(
    () => new Promise<void>((resolve) => (settle = resolve))
  );
  const { container } = render(
    <Instruction idlInstruction={IX} onCall={onCall} />
  );

  fireEvent.click(screen.getByRole("button", { name: "Call increment" }));
  const busy = await screen.findByRole("button", { name: /Calling…/ });
  expect((busy as HTMLButtonElement).disabled).toBe(true);
  expect(container.querySelector("fieldset")?.disabled).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Fill" }) as HTMLButtonElement).disabled
  ).toBe(true);

  await act(async () => settle());
  expect(
    (
      screen.getByRole("button", {
        name: "Call increment",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
  expect(container.querySelector("fieldset")?.disabled).toBe(false);
});

const FORM_IX = {
  name: "deposit",
  args: [{ name: "amount" }],
  accounts: [{ name: "owner" }],
} as unknown as Props["idlInstruction"];

const callButton = () =>
  screen.getByRole("button", { name: "Call deposit" }) as HTMLButtonElement;

afterEach(() => {
  stored.amount = { value: "5", error: false };
});

// The chip row remounts the form per instruction, and the inputs report
// nothing on mount, so the form has to read its restored values itself
it("enables Call for a valid form restored after leaving and returning", () => {
  const first = render(
    <Instruction idlInstruction={FORM_IX} onCall={vi.fn()} />
  );
  first.unmount();

  render(<Instruction idlInstruction={FORM_IX} onCall={vi.fn()} />);

  expect(callButton().disabled).toBe(false);
});

it("keeps Call off for a restored form with an empty custom field", () => {
  stored.amount = { value: "", error: false };
  render(<Instruction idlInstruction={FORM_IX} onCall={vi.fn()} />);

  expect(callButton().disabled).toBe(true);
});

it("keeps Call off for a restored form with a field in error", () => {
  stored.amount = { value: "x", error: true };
  render(<Instruction idlInstruction={FORM_IX} onCall={vi.fn()} />);

  expect(callButton().disabled).toBe(true);
});

afterEach(() => {
  wallet.current = {};
});

it("says Call waits for a wallet while none is connected", () => {
  wallet.current = undefined;
  render(<Instruction idlInstruction={IX} onCall={vi.fn()} />);

  expect(callButtonOf("increment").disabled).toBe(true);
  expect(screen.getByText("Connect a wallet to call")).toBeTruthy();
});

it("says Call waits for the fields while one is empty", () => {
  stored.amount = { value: "", error: false };
  render(<Instruction idlInstruction={FORM_IX} onCall={vi.fn()} />);

  expect(screen.getByText("Fill every field to call")).toBeTruthy();
});

it("leaves the reason to the stage when the caller blocks Call", () => {
  wallet.current = undefined;
  render(<Instruction idlInstruction={IX} onCall={vi.fn()} callBlocked />);

  expect(screen.queryByText("Connect a wallet to call")).toBeNull();
});

const callButtonOf = (name: string) =>
  screen.getByRole("button", { name: `Call ${name}` }) as HTMLButtonElement;

afterEach(() => {
  network.hold = undefined;
});

it("holds Call while the network is down, and says why first", () => {
  network.hold = "Devnet is not responding";
  stored.amount = { value: "", error: false };
  render(<Instruction idlInstruction={FORM_IX} onCall={vi.fn()} />);

  expect(callButton().disabled).toBe(true);
  expect(screen.getByText("Devnet is not responding")).toBeTruthy();
  expect(screen.queryByText("Fill every field to call")).toBeNull();
});
