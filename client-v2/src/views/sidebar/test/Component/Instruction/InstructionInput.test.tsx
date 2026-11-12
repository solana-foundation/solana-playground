// `updateRefs` fills a dependent input through
// `document.getElementById(instruction.name + prefix + name)`, so the input
// must keep that id however it is styled.
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import { requireFor } from "@/test-utils/require-for";

import type { GeneratableInstruction } from "../../../../../utils/program-interaction";
import InstructionInput from "./InstructionInput";
import InstructionProvider from "./InstructionProvider";

// `vi.mock` is hoisted above the imports
const h = vi.hoisted(() => ({ change: vi.fn(), edited: false }));
vi.mock("../../../../../utils", () => ({
  PgCommon: { isEqual: () => !h.edited, changeInputValue: h.change },
  PgWallet: { current: null },
  PgWeb3: {},
}));
vi.mock("../../../../../utils/program-interaction", () => ({
  PgProgramInteraction: {
    getIdlType: () => ({
      name: "u64",
      parse: (v: string) => v,
      generateRandom: () => "1",
    }),
    generateValue: () => (h.edited ? "typed" : ""),
  },
}));
vi.mock("../../../../../components/SearchBar", () => ({
  default: (props: { id: string }) => <input id={props.id} />,
}));
vi.mock("./FromSeed", () => ({ default: () => null }));
vi.mock("../IdlProvider", () => ({ useIdl: () => ({ idl: {} }) }));

it("the input keeps the id dependent fields are filled through", () => {
  const instruction = {
    name: "initialize",
    values: { args: [], accounts: [] },
  } as unknown as GeneratableInstruction;
  render(
    <TooltipProvider>
      <InstructionProvider instruction={instruction} setInstruction={vi.fn()}>
        <InstructionInput
          prefix="args"
          name="amount"
          type="u64"
          generator={{ type: "Custom", value: "" }}
          updateInstruction={vi.fn()}
        />
      </InstructionProvider>
    </TooltipProvider>
  );
  expect(document.getElementById("initializeargsamount")).not.toBeNull();
});

it("re-derives an address whose seed program is the edited field", () => {
  h.edited = true;
  const instruction = {
    name: "initialize",
    values: {
      args: [],
      accounts: [
        {
          name: "vault",
          generator: {
            type: "From seed",
            seeds: [],
            programId: { generator: { type: "Accounts", name: "program" } },
          },
        },
      ],
    },
  } as unknown as GeneratableInstruction;
  let updateRefs:
    | ((data: { name: string }, type: "Accounts") => void)
    | undefined;
  render(
    <TooltipProvider>
      <InstructionProvider
        instruction={instruction}
        setInstruction={(update) => {
          if (typeof update === "function") update(instruction);
        }}
      >
        <InstructionInput
          prefix="accounts"
          name="program"
          type="publicKey"
          generator={{ type: "Custom", value: "typed" }}
          updateInstruction={(update) => {
            updateRefs = update.updateRefs as typeof updateRefs;
          }}
        />
      </InstructionProvider>
    </TooltipProvider>
  );

  requireFor("updateRefs")(updateRefs)({ name: "program" }, "Accounts");

  expect(h.change).toHaveBeenCalled();
});
