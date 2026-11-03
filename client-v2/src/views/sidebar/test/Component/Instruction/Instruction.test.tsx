// The utils and hooks barrels read build-time globals jsdom lacks, and the
// inputs need a connected program; the folds under test need none of it.
vi.mock("../../../../../utils", () => ({
  PgCommand: {},
  PgCommon: { debounce: (fn: () => void) => fn },
  PgConnection: {},
  PgSettings: {},
  PgTerminal: {},
  PgTx: {},
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
vi.mock("../../../../../components/Button", () => ({
  default: (props: { children: string }) => <button>{props.children}</button>,
}));
vi.mock("./InstructionInput", () => ({ default: () => null }));
vi.mock("../IdlProvider", () => ({ useIdl: () => ({ idl: {} }) }));

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import Instruction from "./Instruction";

const draw = () =>
  render(
    <Instruction
      idlInstruction={
        {
          name: "increment",
          args: [{ name: "amount" }],
          accounts: [{ name: "owner" }],
        } as unknown as Parameters<typeof Instruction>[0]["idlInstruction"]
      }
    />
  );

it("heads the card with what it takes", () => {
  draw();
  expect(
    screen.getByRole("button", { name: /^increment/ }).textContent
  ).toContain("1 arg · 1 account");
});

it("names the arguments and the accounts as plain groups, not folds", () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: /^increment/ }));

  expect(screen.getByRole("heading", { name: "Arguments" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Accounts" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Args" })).toBeNull();
});

it("says why Test waits while a field is empty", () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: /^increment/ }));

  expect(screen.getByRole("button", { name: "Test" })).toHaveProperty(
    "disabled",
    true
  );
  expect(screen.getByText("Fill every field to test")).toBeTruthy();
});
