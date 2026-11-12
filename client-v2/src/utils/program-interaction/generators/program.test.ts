// Calls `vi.mock` of its own, so a file of its own rather than an in-source
// block (AGENTS.md, "a module's unit tests live in the module")
import { describe, expect, it, vi } from "vitest";

import { PgWeb3 } from "../../web3";
import { getPrograms } from "./program";

// `utils` reads `GLOBAL_SETTINGS`, a global only webpack defines, absent
// under vitest
vi.hoisted(() => {
  vi.stubGlobal("GLOBAL_SETTINGS", { default: {} });
});

// The real wasm packages need a Rust build; the mock keeps the test off them
vi.mock("../../package", () => ({ PgPackage: {} }));

describe("utils/program-interaction/generators/program", () => {
  it("lists only program ids that decode to 32 bytes", () => {
    for (const { name, programId } of getPrograms()) {
      expect(new PgWeb3.PublicKey(programId).toBytes(), name).toHaveLength(32);
    }
  });

  it("lists each program under its canonical id", () => {
    expect(
      Object.fromEntries(getPrograms().map((p) => [p.name, p.programId]))
    ).toEqual({
      System: "11111111111111111111111111111111",
      Token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "Token 2022": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "Associated Token": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "Token Metadata": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    });
  });
});
