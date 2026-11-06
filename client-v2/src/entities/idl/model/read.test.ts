import { BN, BorshAccountsCoder, BorshCoder } from "@coral-xyz/anchor";
import { eventDiscriminator } from "@coral-xyz/anchor/dist/cjs/coder/borsh/event";
import type {
  Idl,
  IdlAccount,
  IdlAccountItem,
  IdlField,
  IdlType,
  IdlTypeDef,
} from "@coral-xyz/anchor/dist/cjs/idl";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import { describe, expect, it } from "vitest";

import ammV3 from "./__fixtures__/amm_v3.json";
import generics from "./__fixtures__/generics.json";
import idlFixture from "./__fixtures__/idl.json";
import pda from "./__fixtures__/pda.json";
import relations from "./__fixtures__/relations.json";
import { programName, readIdl } from "./read";
import type { IdlV1 } from "./types";

const FIXTURES = {
  ammV3,
  generics,
  idl: idlFixture,
  pda,
  relations,
} as unknown as Record<string, IdlV1>;

/** The converted IDL, failing the test when the reading is not `v1` */
const legacy = (raw: unknown): Idl => {
  const reading = readIdl(raw);
  if (reading.kind !== "v1") {
    throw new Error(`expected v1, got ${JSON.stringify(reading)}`);
  }
  return reading.idl;
};

/** A plain value of the given type, so every instruction can be encoded */
const sample = (type: IdlType, idl: Idl): unknown => {
  if (typeof type === "string") {
    switch (type) {
      case "bool":
        return true;
      case "string":
        return "pg";
      case "bytes":
        return Buffer.from([1, 2]);
      case "publicKey":
        return new PublicKey("11111111111111111111111111111112");
      case "f32":
      case "f64":
        return 1.5;
      case "u8":
      case "i8":
      case "u16":
      case "i16":
      case "u32":
      case "i32":
        return 7;
      default:
        return new BN(7);
    }
  }
  // eslint-disable-next-line unicorn/no-null -- the Borsh coder encodes an option's None from null
  if ("option" in type || "coption" in type) return null;
  if ("vec" in type) return [sample(type.vec, idl)];
  if ("array" in type) {
    return Array.from({ length: type.array[1] }, () =>
      sample(type.array[0], idl)
    );
  }
  const def = (idl.types ?? [])
    .concat((idl.accounts ?? []) as IdlTypeDef[])
    .find((t) => t.name === type.defined);
  if (!def) throw new Error(`missing type ${type.defined}`);
  if (def.type.kind === "struct") {
    return Object.fromEntries(
      (def.type.fields as IdlField[]).map((f) => [f.name, sample(f.type, idl)])
    );
  }
  if (def.type.kind === "enum") {
    // The 0.29 coder keys a variant by its camelCase name and a tuple
    // variant's fields by their index
    const v = def.type.variants[0];
    const key = v.name.charAt(0).toLowerCase() + v.name.slice(1);
    if (!v.fields) return { [key]: {} };
    const fields = v.fields as Array<IdlField | IdlType>;
    const named = typeof fields[0] === "object" && "name" in fields[0];
    return {
      [key]: named
        ? Object.fromEntries(
            (fields as IdlField[]).map((f) => [f.name, sample(f.type, idl)])
          )
        : Object.fromEntries(
            (fields as IdlType[]).map((t, i) => [String(i), sample(t, idl)])
          ),
    };
  }
  throw new Error(`unexpected kind ${def.type.kind}`);
};

/** The value, failing the test with what was missing when there is none */
const found = <T>(value: T | null | undefined, what: string): T => {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
};

const accountsOf = (items: IdlAccountItem[]): IdlAccount[] =>
  items.flatMap((a) =>
    "accounts" in a ? accountsOf(a.accounts) : [a as IdlAccount]
  );

describe("entities/idl/model/read", () => {
  it("returns a 0.29 IDL as it is", () => {
    const old = {
      version: "0.1.0",
      name: "counter",
      instructions: [
        {
          name: "increment",
          accounts: [{ name: "counter", isMut: true, isSigner: false }],
          args: [],
        },
      ],
    };
    const reading = readIdl(old);
    expect(reading).toEqual({ kind: "v029", idl: old });
    if (reading.kind === "v029") expect(reading.idl).toBe(old);
  });

  // eslint-disable-next-line unicorn/no-null -- a JSON `null` is one of the raw inputs under test
  it.each([
    null,
    {},
    { instructions: 1 },
    "idl",
    { address: "x" },
    { name: "x", instructions: [] },
  ])("refuses %j as not an Anchor IDL", (raw) => {
    expect(readIdl(raw)).toEqual({
      kind: "refused",
      version: undefined,
      reason: "not an Anchor IDL",
    });
  });

  it("reads the same object to the same conversion", () => {
    expect(legacy(pda)).toBe(legacy(pda));
  });

  it.each(Object.keys(FIXTURES))(
    "%s: every instruction encodes to its 1.x discriminator and round-trips",
    (key) => {
      const raw = FIXTURES[key];
      const conv = legacy(raw);
      const coder = new BorshCoder(conv);
      expect(conv.instructions).toHaveLength(raw.instructions.length);
      raw.instructions.forEach((ix, i) => {
        const cix = conv.instructions[i];
        const args = Object.fromEntries(
          cix.args.map((a) => [a.name, sample(a.type, conv)])
        );
        const data = coder.instruction.encode(cix.name, args);
        expect(Array.from(data.subarray(0, 8))).toEqual(ix.discriminator);
        const decoded = coder.instruction.decode(data);
        expect(decoded?.name).toBe(cix.name);
        expect(
          coder.instruction.encode(
            cix.name,
            found(decoded, "decoded instruction").data
          )
        ).toEqual(data);
      });
    }
  );

  it.each(Object.keys(FIXTURES))(
    "%s: accounts and events keep their 1.x discriminators",
    (key) => {
      const raw = FIXTURES[key];
      const conv = legacy(raw);
      // An account type an argument reaches and another type holds is kept
      // in `types` only (see `toLegacyIdl`); every other one is an account
      const kept = new Set(
        (conv.accounts ?? [])
          .map((a) => a.name)
          .concat((conv.types ?? []).map((t) => t.name))
      );
      for (const a of raw.accounts ?? []) expect(kept).toContain(a.name);
      for (const a of raw.accounts ?? []) {
        expect(
          Array.from(BorshAccountsCoder.accountDiscriminator(a.name))
        ).toEqual(a.discriminator);
      }
      for (const e of raw.events ?? []) {
        expect(Array.from(eventDiscriminator(e.name))).toEqual(e.discriminator);
        expect(conv.events?.find((c) => c.name === e.name)).toBeDefined();
      }
      // A new coder accepts the whole IDL, accounts and events included
      expect(() => new BorshCoder(conv)).not.toThrow();
    }
  );

  it("names instructions, accounts and args in camelCase with 0.29 flags", () => {
    const conv = legacy(relations);
    const raw = relations as unknown as IdlV1;
    expect(conv.name).toBe(raw.metadata.name);
    expect(conv.version).toBe(raw.metadata.version);
    expect(conv.metadata).toEqual({ address: raw.address });
    for (const ix of conv.instructions) {
      expect(ix.name).not.toMatch(/_/);
      for (const acc of accountsOf(ix.accounts)) {
        expect(acc.name).not.toMatch(/_/);
        expect(typeof acc.isMut).toBe("boolean");
        expect(typeof acc.isSigner).toBe("boolean");
      }
    }
  });

  it("instantiates a generic type with its arguments", () => {
    const conv = legacy(generics);
    const ix = found(
      conv.instructions.find((i) => i.name === "generic"),
      "instruction generic"
    );
    expect(ix.args[0]).toEqual({
      name: "genericField",
      type: { defined: "GenericType<u32, u64, 10>" },
    });
    const def = found(conv.types, "converted types").find(
      (t) => t.name === "GenericType<u32, u64, 10>"
    );
    const fields = def?.type.kind === "struct" ? def.type.fields : [];
    expect(fields.find((f) => f.name === "gen1")?.type).toBe("u32");
    expect(fields.find((f) => f.name === "arr")?.type).toEqual({
      array: ["u8", 10],
    });
    // No generic placeholder survives anywhere
    expect(JSON.stringify(conv)).not.toMatch(/\{"generic":/);
  });

  it("types PDA seeds and keeps a const seed's text", () => {
    const conv = legacy(pda);
    const acc = found(
      accountsOf(conv.instructions[0].accounts).find(
        (a) => a.name === "pdaAccount"
      ),
      "account pdaAccount"
    );
    expect(acc.pda).toEqual({
      seeds: [
        { kind: "const", type: "string", value: "hello_world" },
        { kind: "account", type: "publicKey", path: "signer" },
      ],
    });
  });

  it("carries a seed program and a nested seed's field type", () => {
    const conv = legacy(ammV3);
    const all = conv.instructions.flatMap((ix) => accountsOf(ix.accounts));
    const withProgram = all.filter((a) => a.pda?.programId);
    expect(withProgram.length).toBeGreaterThan(0);
    for (const a of withProgram) {
      const programId = found(a.pda?.programId, "pda programId");
      expect(programId).toMatchObject({
        kind: "const",
        type: "publicKey",
      });
      expect(typeof programId.value).toBe("string");
    }
    const seeds = all.flatMap((a) => a.pda?.seeds ?? []);
    for (const s of seeds) expect(s.type).toBeDefined();
    const args = seeds.filter((s) => s.kind === "arg");
    expect(args.length).toBeGreaterThan(0);
    // A seed read from inside an account's data cannot be filled by the
    // generator, so its account is left to the person
    for (const s of seeds) expect(s.path ?? "").not.toMatch(/\./);
    const raw = ammV3 as unknown as IdlV1;
    const nestedIx = found(
      raw.instructions.find((ix) =>
        ix.accounts.some(
          (a) =>
            "pda" in a &&
            a.pda?.seeds.some((s) => s.kind !== "const" && s.path.includes("."))
        )
      ),
      "an instruction with a nested seed"
    );
    const nestedAcc = found(
      nestedIx.accounts.find(
        (a) =>
          "pda" in a &&
          a.pda?.seeds.some((s) => s.kind !== "const" && s.path.includes("."))
      ),
      "an account with a nested seed"
    );
    const conv2 = found(
      conv.instructions.find(
        (ix) =>
          ix.name === nestedIx.name.replace(/_(.)/g, (_, c) => c.toUpperCase())
      ),
      "the converted instruction"
    );
    const mapped = found(
      accountsOf(conv2.accounts).find(
        (a) =>
          a.name === nestedAcc.name.replace(/_(.)/g, (_, c) => c.toUpperCase())
      ),
      "the converted account"
    );
    expect(mapped.pda).toBeUndefined();
  });

  it("refuses an instruction with a custom discriminator", () => {
    const raw = JSON.parse(JSON.stringify(pda)) as IdlV1;
    raw.instructions[0].discriminator = [1];
    expect(readIdl(raw)).toEqual({
      kind: "refused",
      version: "1",
      reason: "a custom discriminator on test_instruction",
    });
  });

  it("refuses an account with a custom discriminator", () => {
    const raw = JSON.parse(JSON.stringify(relations)) as IdlV1;
    const account = found(raw.accounts, "accounts")[0];
    account.discriminator = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(readIdl(raw)).toMatchObject({
      kind: "refused",
      reason: `a custom discriminator on ${account.name}`,
    });
  });

  describe("edge cases", () => {
    /** A one-instruction 1.x IDL; `ix` overrides the instruction */
    /** A one-instruction 1.x IDL; every field of the instruction is named */
    const one = ({
      name = "initialize",
      discriminator = [175, 175, 109, 31, 13, 152, 155, 237],
      accounts = [],
      args = [],
    }: {
      name?: string;
      discriminator?: number[];
      accounts?: unknown[];
      args?: unknown[];
    }) =>
      ({
        address: "11111111111111111111111111111111",
        metadata: { name: "edge", version: "0.1.0", spec: "0.1.0" },
        instructions: [{ name, discriminator, accounts, args }],
        types: [],
      } as unknown as IdlV1);

    const pdaWith = (args: unknown[]) => (seeds: unknown[]) => {
      const conv = legacy(
        one({ accounts: [{ name: "vault", pda: { seeds } }], args })
      );
      return accountsOf(conv.instructions[0].accounts)[0].pda;
    };
    const pdaOf = pdaWith([]);

    it.each([
      [[104, 105], { kind: "const", type: "string", value: "hi" }],
      // `string.parse` drops quotes: such text goes as bytes
      [[105, 39, 115], { kind: "const", type: "bytes", value: "[105,39,115]" }],
      [[32, 104], { kind: "const", type: "bytes", value: "[32,104]" }],
      [[0, 1], { kind: "const", type: "bytes", value: "[0,1]" }],
      [[255], { kind: "const", type: "bytes", value: "[255]" }],
      [
        Array.from({ length: 32 }, (_, i) => i),
        {
          kind: "const",
          type: "publicKey",
          value: new PublicKey(
            Uint8Array.from({ length: 32 }, (_, i) => i)
          ).toBase58(),
        },
      ],
    ])("const seed %j", (value, expected) => {
      expect(pdaOf([{ kind: "const", value }])?.seeds).toEqual([expected]);
    });

    it("types an argument seed from the argument and camelCases its path", () => {
      expect(
        pdaWith([{ name: "max_amount", type: "u32" }])([
          { kind: "arg", path: "max_amount" },
        ])?.seeds
      ).toEqual([{ kind: "arg", type: "u32", path: "maxAmount" }]);
    });

    it.each([
      ["an unknown argument", [{ kind: "arg", path: "missing" }]],
      ["a dotted path", [{ kind: "account", path: "pool.config" }]],
      [
        "another account's data",
        [{ kind: "account", path: "pool", account: "Pool" }],
      ],
    ])("leaves the account to the person for %s", (_, seeds) => {
      expect(pdaOf(seeds)).toBeUndefined();
    });

    it("keeps a name whose camelCase does not hash back", () => {
      const sighash = Array.from(
        createHash("sha256")
          .update("global:add_2_things")
          .digest()
          .subarray(0, 8)
      );
      const conv = legacy(
        one({ name: "add_2_things", discriminator: sighash })
      );
      const name = conv.instructions[0].name;
      const data = new BorshCoder(conv).instruction.encode(name, {});
      expect(Array.from(data.subarray(0, 8))).toEqual(sighash);
    });

    it("refuses two instructions that meet under one method name", () => {
      const sighash = (name: string) =>
        Array.from(
          createHash("sha256").update(`global:${name}`).digest().subarray(0, 8)
        );
      const raw = one({ name: "add_2", discriminator: sighash("add_2") });
      raw.instructions.push({
        name: "add2",
        discriminator: sighash("add2"),
        accounts: [],
        args: [],
      });
      expect(readIdl(raw)).toEqual({
        kind: "refused",
        version: "1",
        reason: "two instructions named add2",
      });
    });

    it("reads a spec 0.1.0 IDL that has no address", () => {
      const raw = JSON.parse(JSON.stringify(pda));
      delete raw.address;
      expect(readIdl(raw).kind).toBe("v1");
    });

    it.each([
      [
        "an unknown primitive",
        { name: "x", type: "u512" },
        "an unknown type u512",
      ],
      [
        "an unbound generic",
        { name: "x", type: { generic: "T" } },
        "an unbound generic T",
      ],
      [
        "an unknown defined type",
        { name: "x", type: { defined: { name: "Nope" } } },
        "an unknown type Nope",
      ],
      // eslint-disable-next-line max-params -- it.each spreads each table row into the callback
    ])("refuses %s", (_, arg, reason) => {
      expect(readIdl(one({ args: [arg] }))).toEqual({
        kind: "refused",
        version: "1",
        reason,
      });
    });
  });
});

describe("programName", () => {
  it("reads a 1.x IDL's name from its metadata", () => {
    expect(programName({ metadata: { name: "vault" }, name: "x" })).toBe(
      "vault"
    );
  });

  /** A deploy adds `metadata.address` to a legacy IDL, and no name */
  it("reads a deployed legacy IDL's own name", () => {
    expect(
      programName({ name: "counter", metadata: { address: "6PNd" } })
    ).toBe("counter");
  });

  it("has none for an IDL without a usable name", () => {
    expect(programName({ name: "", metadata: { name: 5 } })).toBeUndefined();
  });
});
