// The utils barrel reads build-time globals jsdom lacks, and the inputs need
// a connected program; the form under test needs none of it.
vi.mock("../../../../../utils", () => ({
  PgCommon: { debounce: (fn: () => void) => fn },
}));
vi.mock("../../../../../utils/program-interaction", () => ({
  PgProgramInteraction: {
    getOrCreateInstruction: (ix: { name: string }) => ({
      name: ix.name,
      values: { args: [{ name: "amount" }], accounts: [{ name: "owner" }] },
    }),
    saveInstruction: vi.fn(),
  },
}));
vi.mock("../../../../../hooks", () => ({ useWallet: () => ({}) }));
vi.mock("./InstructionInput", () => ({ default: () => null }));
vi.mock("../IdlProvider", () => ({ useIdl: () => ({ idl: {} }) }));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

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
