// `updateRefs` fills a dependent input through
// `document.getElementById(instruction.name + prefix + name)`, so the input
// must keep that id however it is styled.
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import InstructionInput from "./InstructionInput";
import InstructionProvider from "./InstructionProvider";
import type { GeneratableInstruction } from "../../../../../utils/program-interaction";

// `vi.mock` is hoisted above the imports
vi.mock("../../../../../utils", () => ({
  PgCommon: { isEqual: () => true },
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
    generateValue: () => "",
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
