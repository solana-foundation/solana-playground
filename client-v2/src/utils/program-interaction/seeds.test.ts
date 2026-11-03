// @vitest-environment node
// Every PDA the From-seed generator fills on an Anchor 1.x IDL (spec 0.1.0)
// derives the address Anchor derives from the same seeds; a PDA whose seed
// reads another account's data is not filled. Node, because web3's address
// search rejects jsdom's Uint8Array
import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";

import { readIdl, type IdlV1 } from "@/entities/idl";
import amm from "@/entities/idl/model/__fixtures__/amm_v3.json";
import generics from "@/entities/idl/model/__fixtures__/generics.json";
import idlJson from "@/entities/idl/model/__fixtures__/idl.json";
import pda from "@/entities/idl/model/__fixtures__/pda.json";
import relations from "@/entities/idl/model/__fixtures__/relations.json";
import { generateValue } from "./generator";
import type { Idl, IdlInstruction } from "./idl-types";
import { createGeneratableInstruction } from "./instruction";
import { PgWeb3 } from "../web3";

// generator.ts and instruction.ts import the wallet, the program-info store
// and the known-programs list; stub them so only the seed code loads
const current = vi.hoisted(() => ({ pk: "" }));
vi.mock("./generators", () => ({ getPrograms: () => [] }));
vi.mock("../wallet", () => ({ PgWallet: {} }));
// "Current program" resolves to the IDL's own address
vi.mock("../program-info", () => ({
  PgProgramInfo: { getPkStr: () => current.pk },
}));

type RawSeed = {
  kind: "const" | "arg" | "account";
  value?: number[];
  path?: string;
  account?: string;
};
type RawAccount = {
  name: string;
  accounts?: RawAccount[];
  pda?: { seeds: RawSeed[]; program?: RawSeed };
};
type RawArg = { name: string; type: unknown };
type RawIx = { name: string; accounts: RawAccount[]; args: RawArg[] };
type RawIdl = { address?: string; instructions: RawIx[] };

const sha256 = (text: string) => createHash("sha256").update(text).digest();

/** One PDA per integer width, each seeded by its argument */
const WIDTHS = ["i8", "i16", "i32", "i64", "i128", "u8", "u64"];
const widths = {
  address: "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
  metadata: { name: "widths", version: "0.1.0", spec: "0.1.0" },
  instructions: WIDTHS.map((type) => ({
    name: `seed_${type}`,
    // Anchor's default discriminator, so the reader takes this IDL
    discriminator: Array.from(sha256(`global:seed_${type}`).subarray(0, 8)),
    accounts: [
      { name: "payer", writable: true, signer: true },
      {
        name: "slot",
        writable: true,
        pda: {
          seeds: [
            { kind: "const", value: Array.from(Buffer.from("slot")) },
            { kind: "arg", path: "value" },
          ],
        },
      },
    ],
    args: [{ name: "value", type }],
  })),
};

const FIXTURES = {
  amm,
  generics,
  idlJson,
  pda,
  relations,
  widths,
} as unknown as Record<string, RawIdl>;

/**
 * A value per argument type. A signed width gets a small negative: its
 * magnitude bytes differ from its two's complement, where a width's minimum
 * (`00 80`) reads the same either way and would hide the bug
 */
const ARG_VALUES: Record<string, string> = {
  i8: "-2",
  i16: "-2",
  i32: "-7",
  i64: "-2",
  i128: "-5",
  u8: "200",
  u16: "300",
  u64: "18446744073709551615",
  string: "seed-text",
  bool: "true",
};

/** Anchor's bytes for an argument seed, built without the code under test */
const argBytes = (type: unknown, value: string): Buffer => {
  if (typeof type !== "string") {
    throw new Error(`no seed rule in this test for ${JSON.stringify(type)}`);
  }
  const int = type.match(/^[iu](8|16|32|64|128)$/);
  if (int) {
    const bits = Number(int[1]);
    // Two's complement by modulus, then little-endian byte by byte
    let n = BigInt(value);
    if (n < 0n) n += 1n << BigInt(bits);
    return Buffer.from(
      Array.from({ length: bits / 8 }, (_, i) =>
        Number((n >> BigInt(8 * i)) & 0xffn)
      )
    );
  }
  if (type === "string") return Buffer.from(value);
  if (type === "bool") return Buffer.from([value === "true" ? 1 : 0]);
  throw new Error(`no seed rule in this test for an argument of type ${type}`);
};

/** A fixed key per name, so a failing case replays with the same keys */
const keyOf = (name: string) => new PgWeb3.PublicKey(sha256(name));

/** What the fixtures hold, counted as the cases are collected */
const covered = { filled: 0, signed: 0, left: [] as string[] };

describe("utils/program-interaction seeds on Anchor 1.x IDLs", () => {
  for (const [file, raw] of Object.entries(FIXTURES)) {
    const reading = readIdl(raw as unknown as IdlV1);
    it(`${file} reads`, () => {
      expect(reading.kind).not.toBe("refused");
    });
    if (reading.kind === "refused") continue;
    const idl = reading.idl as Idl;

    raw.instructions.forEach((rawIx, i) => {
      const ixIdl = idl.instructions[i] as IdlInstruction;
      // `createGeneratableInstruction` maps accounts as flat (its TODO on
      // composite accounts), so a group's inner PDAs get no seed generator
      if (rawIx.accounts.some((a) => a.accounts)) return;

      rawIx.accounts.forEach((rawAcc, j) => {
        if (!rawAcc.pda) return;
        const seeds = rawAcc.pda.seeds;
        const label = `${file} ${rawIx.name}.${rawAcc.name}`;
        const typeOf = (s: RawSeed) =>
          rawIx.args.find((a) => a.name === s.path)?.type;
        // The rule the reader follows, restated; `covered.left` below pins
        // its outcome by name, so the two copies cannot agree on a wrong rule
        const fillable = seeds.every(
          (s) =>
            s.kind === "const" ||
            (!s.path!.includes(".") && !(s.kind === "account" && s.account))
        );
        if (!fillable) covered.left.push(label);
        else covered.filled++;
        const signed = seeds.some(
          (s) => s.kind === "arg" && /^i/.test(String(typeOf(s)))
        );
        if (fillable && signed) covered.signed++;

        it(label, () => {
          const { values } = createGeneratableInstruction(ixIdl);
          const program = raw.address
            ? new PgWeb3.PublicKey(raw.address)
            : keyOf(file);
          current.pk = program.toBase58();

          if (!fillable) {
            expect(values.accounts[j].generator.type).not.toBe("From seed");
            return;
          }
          expect(values.accounts[j].generator.type).toBe("From seed");

          // Every other account a fixed key, every argument a value
          values.accounts.forEach((a, k) => {
            if (k === j) return;
            const value = keyOf(rawIx.accounts[k].name).toBase58();
            a.generator = { type: "Custom", value };
          });
          values.args.forEach((a, k) => {
            const value = ARG_VALUES[rawIx.args[k].type as string] ?? "";
            a.generator = { type: "Custom", value };
          });

          const bytesOf = (s: RawSeed): Buffer => {
            if (s.kind === "const") return Buffer.from(s.value!);
            if (s.kind === "account") return keyOf(s.path!).toBuffer();
            return argBytes(typeOf(s), ARG_VALUES[String(typeOf(s))]);
          };
          const seedProgram = rawAcc.pda!.program
            ? new PgWeb3.PublicKey(bytesOf(rawAcc.pda!.program))
            : program;
          const [expected] = PgWeb3.PublicKey.findProgramAddressSync(
            seeds.map(bytesOf),
            seedProgram
          );

          expect(generateValue(values.accounts[j].generator, values)).toBe(
            expected.toBase58()
          );
        });
      });
    });
  }

  // Counted at collection, so a filter or a failing case changes nothing:
  // amm_v3 has 27 fillable PDAs (9 with an i32 seed) and 4 that read account
  // data; idl.json has 2, pda.json 1, relations.json 1 (its composite
  // instruction is skipped) and widths 7 (5 signed)
  it("covers every PDA the fixtures hold", () => {
    expect(covered).toEqual({
      filled: 38,
      signed: 14,
      left: [
        "amm decrease_liquidity.protocol_position",
        "amm decrease_liquidity_v2.protocol_position",
        "amm increase_liquidity.protocol_position",
        "amm increase_liquidity_v2.protocol_position",
      ],
    });
  });
});
