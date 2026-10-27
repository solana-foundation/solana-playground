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

it("starts with the Args and Accounts folds open", () => {
  render(
    <Instruction
      idlInstruction={
        {
          name: "increment",
          args: [],
          accounts: [],
        } as unknown as Parameters<typeof Instruction>[0]["idlInstruction"]
      }
    />
  );
  // The instruction's own fold is closed, so open it to reach the two inside.
  fireEvent.click(screen.getByRole("button", { name: "increment" }));

  expect(
    screen.getByRole("button", { name: "Args" }).getAttribute("aria-expanded")
  ).toBe("true");
  expect(
    screen
      .getByRole("button", { name: "Accounts" })
      .getAttribute("aria-expanded")
  ).toBe("true");
});
