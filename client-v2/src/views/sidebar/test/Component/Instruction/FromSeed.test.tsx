// "From seed" reopened on a pre-filled account derives with the seed program
// the account already has: an associated token account does not derive under
// the program being called.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  values: {} as unknown,
  generateValue: vi.fn((generator?: { value: string }) => generator?.value),
}));

vi.mock("../../../../../utils/program-interaction", () => ({
  PgProgramInteraction: {
    generateValue: mocks.generateValue,
    generateProgramAddressFromSeeds: () => ({ toBase58: () => "derived" }),
    getPrograms: () => [],
  },
}));
vi.mock("../../../../../components/SearchBar", () => ({
  default: () => undefined,
}));
vi.mock("../../../../../hooks", () => ({ useKeybind: () => undefined }));
vi.mock("../../../../../components/Icons", () => ({
  Edit: () => undefined,
  Plus: () => undefined,
  Trash: () => undefined,
}));
vi.mock("./InstructionInput", () => ({ default: () => undefined }));
vi.mock("./InstructionProvider", () => ({
  useInstruction: () => ({ instruction: { values: mocks.values } }),
}));
vi.mock("../InputLabel", () => ({ default: () => undefined }));

import { TooltipProvider } from "@/shared/ui/tooltip";

import FromSeed from "./FromSeed";

const CURRENT = { generator: { type: "Current program", value: "current" } };
const ATA_PROGRAM = { generator: { type: "Custom", value: "ata" } };

const seedProgramOfTheGeneratedAddress = () => {
  const search = vi.fn();
  render(
    <TooltipProvider>
      <FromSeed name="vault" search={search} />
    </TooltipProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  return search.mock.calls[0][0].data.programId;
};

describe("FromSeed", () => {
  beforeEach(() => mocks.generateValue.mockClear());

  it("keeps the seed program an account already derives with", () => {
    mocks.values = {
      programId: CURRENT,
      accounts: [
        {
          name: "vault",
          generator: { type: "From seed", seeds: [], programId: ATA_PROGRAM },
        },
      ],
    };

    expect(seedProgramOfTheGeneratedAddress()).toEqual(ATA_PROGRAM);
  });

  it("starts from the instruction's program on an account with no seeds", () => {
    mocks.values = {
      programId: CURRENT,
      accounts: [{ name: "vault", generator: { type: "Custom", value: "" } }],
    };

    expect(seedProgramOfTheGeneratedAddress()).toEqual(CURRENT);
  });
});
