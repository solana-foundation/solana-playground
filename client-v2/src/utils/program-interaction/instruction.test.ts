// Mocks `./generators`, whose imports reach the whole playground
import { describe, expect, it, vi } from "vitest";

import type { IdlAccount } from "./idl-types";
import { createGeneratableInstruction } from "./instruction";

vi.mock("./generators", () => ({ getPrograms: () => [] }));

describe("utils/program-interaction/instruction", () => {
  const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const SYSTEM = "11111111111111111111111111111111";

  const ix = (accounts: unknown[]) =>
    createGeneratableInstruction({
      name: "initialize",
      accounts: accounts as IdlAccount[],
      args: [{ name: "amount", type: "u64" }],
    });

  it("derives a PDA with the seed program the IDL names", () => {
    const [acc] = ix([
      {
        name: "vault",
        isMut: true,
        isSigner: false,
        pda: {
          seeds: [
            { kind: "account", type: "publicKey", path: "owner" },
            { kind: "arg", type: "u64", path: "amount" },
          ],
          programId: { kind: "const", type: "publicKey", value: ATA },
        },
      },
    ]).values.accounts;
    expect(acc.generator).toEqual({
      type: "From seed",
      seeds: [
        { type: "publicKey", generator: { type: "Accounts", name: "owner" } },
        { type: "u64", generator: { type: "Arguments", name: "amount" } },
      ],
      programId: { generator: { type: "Custom", value: ATA } },
    });
  });

  it("derives with the current program when the IDL names none", () => {
    const [acc] = ix([
      {
        name: "counter",
        isMut: true,
        isSigner: false,
        pda: {
          seeds: [{ kind: "const", type: "string", value: "counter" }],
        },
      },
    ]).values.accounts;
    expect(acc.generator).toEqual({
      type: "From seed",
      seeds: [
        { type: "string", generator: { type: "Custom", value: "counter" } },
      ],
      programId: { generator: { type: "Current program" } },
    });
  });

  it("pre-fills an account the IDL fixes to an address", () => {
    const [acc] = ix([
      { name: "anyName", isMut: false, isSigner: false, address: SYSTEM },
    ]).values.accounts;
    expect(acc.generator).toEqual({ type: "Custom", value: SYSTEM });
  });
});
