import { PgCommon } from "../common";
import type { GeneratableInstruction } from "./generator";
import type { IdlAccount, IdlInstruction } from "./idl-types";

/**
 * Get the instruction from the configured {@link storage}.
 *
 * @param idlIx IDL instruction
 * @returns the saved instruction or `null`
 */
export const getInstruction = (
  idlIx: IdlInstruction
): GeneratableInstruction | null => {
  const savedIx = getAllInstructions()[idlIx.name];
  return savedIx ? { name: idlIx.name, values: savedIx } : null;
};

/**
 * Save the instruction to the configured {@link storage}.
 *
 * @param ix generatable instruction
 */
export const saveInstruction = (ix: GeneratableInstruction) => {
  const savedIxs = getAllInstructions();
  savedIxs[ix.name] = ix.values;
  saveAllInstructions(savedIxs);
};

/**
 * Sync all instructions in storage based on the given IDL.
 *
 * @param idlIxs IDL instructions
 */
export const syncAllInstructions = (idlIxs: IdlInstruction[]) => {
  // Delete the instructions that exists in storage but doesn't exist in the IDL
  const savedIxs = getAllInstructions();
  const ixNames = idlIxs.map((ix) => ix.name);
  const ixNamesToRemove = Object.keys(savedIxs).filter(
    (ixName) => !ixNames.includes(ixName)
  );
  for (const ixName of ixNamesToRemove) delete savedIxs[ixName];

  // Update the instructions that changed
  const ixsNamesToUpdate = idlIxs
    .filter((ix) => {
      const savedIx = savedIxs[ix.name];
      if (!savedIx) return true;

      // Check lengths
      if (savedIx.args.length !== ix.args.length) return true;
      if (savedIx.accounts.length !== ix.accounts.length) return true;

      // Check args
      const isAllArgsEqual = savedIx.args.every((savedArg) => {
        const arg = ix.args.find((ixArg) => ixArg.name === savedArg.name);
        if (!arg) return false;
        return PgCommon.isEqual(arg.type, savedArg.type);
      });
      if (!isAllArgsEqual) return true;

      // Check accounts
      const isAllAccsEqual = savedIx.accounts.every((savedAcc) => {
        const acc = ix.accounts.find((ixAcc) => ixAcc.name === savedAcc.name);
        if (!acc) return false;

        // TODO: Handle composite accounts?
        const { isMut, isSigner } = acc as IdlAccount;
        return savedAcc.isMut === isMut && savedAcc.isSigner === isSigner;
      });
      if (!isAllAccsEqual) return true;

      return false;
    })
    .map((ix) => ix.name);

  // Delete and allow for the instruction to be recrated with default values
  // TODO: Only update the instruction values that changed
  for (const ixName of ixsNamesToUpdate) delete savedIxs[ixName];

  // Save the instructions
  if (ixNamesToRemove.length || ixsNamesToUpdate.length) {
    saveAllInstructions(savedIxs);
  }
};

/**
 * Reset the given instruction in storage {@link storage}.
 *
 * @param ix generatable instruction
 */
export const resetInstruction = (ix: GeneratableInstruction) => {
  const savedIxs = getAllInstructions();
  delete savedIxs[ix.name];
  saveAllInstructions(savedIxs);
};

/** A map of instruction names to generatable instruction values */
type SavedInstructions = Record<string, GeneratableInstruction["values"]>;

/** Storage to use for program interactions */
const storage = sessionStorage;

/** Program interaction key in {@link storage} */
const STORAGE_KEY = "program-interaction";

/**
 * Get all instructions from the {@link storage}.
 *
 * @returns the instructions from storage
 */
const getAllInstructions = (): SavedInstructions => {
  const value = storage.getItem(STORAGE_KEY);
  if (!value) {
    const defaultValue: SavedInstructions = {};
    saveAllInstructions(defaultValue);
    return defaultValue;
  }
  return JSON.parse(value, (_key, saved) =>
    isRetiredGenerator(saved) ? { type: "Custom", value: "" } : saved
  );
};

/** Generator types an older session may have saved that no generator handles */
const RETIRED_GENERATOR_TYPES = ["Pyth"];

/** Whether a parsed value is a generator of a type in {@link RETIRED_GENERATOR_TYPES} */
const isRetiredGenerator = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  RETIRED_GENERATOR_TYPES.includes(
    (value as { type?: unknown }).type as string
  );

/**
 * Save all instructions to the {@link storage}.
 *
 * @param ixs instructions to save to storage
 */
const saveAllInstructions = (ixs: SavedInstructions) => {
  storage.setItem(STORAGE_KEY, JSON.stringify(ixs));
};

if (import.meta.vitest) {
  const { describe, it, expect, afterEach } = import.meta.vitest;

  describe("utils/program-interaction/storage", () => {
    afterEach(() => storage.removeItem(STORAGE_KEY));

    it("reads a retired generator, nested in a seed too, as an empty custom value", () => {
      const pyth = { type: "Pyth", name: "Crypto.SOL/USD" };
      const fromSeed = {
        type: "From seed",
        seeds: [{ type: "publicKey", generator: pyth }],
        programId: { generator: { type: "Current program" } },
      };
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ix: {
            programId: { generator: { type: "Current program" } },
            accounts: [
              { name: "price", isMut: false, isSigner: false, generator: pyth },
              {
                name: "pda",
                isMut: false,
                isSigner: false,
                generator: fromSeed,
              },
            ],
            args: [],
          },
        })
      );

      const accounts = getInstruction({ name: "ix" } as IdlInstruction)?.values
        .accounts;

      const empty = { type: "Custom", value: "" };
      expect(accounts?.[0].generator).toEqual(empty);
      expect(accounts?.[1].generator).toEqual({
        type: "From seed",
        seeds: [{ type: "publicKey", generator: empty }],
        programId: { generator: { type: "Current program" } },
      });
    });
  });
}
