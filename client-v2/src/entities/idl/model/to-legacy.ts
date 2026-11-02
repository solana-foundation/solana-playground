import {
  BorshAccountsCoder,
  BorshInstructionCoder,
  eventDiscriminator,
  type Idl,
} from "@coral-xyz/anchor";
import type {
  IdlAccountItem,
  IdlEnumVariant,
  IdlEventField,
  IdlField,
  IdlSeed,
  IdlType,
  IdlTypeDef,
} from "@coral-xyz/anchor/dist/cjs/idl";
import { PublicKey } from "@solana/web3.js";

import type {
  IdlV1,
  IdlV1AccountItem,
  IdlV1DefinedFields,
  IdlV1Field,
  IdlV1GenericArg,
  IdlV1Instruction,
  IdlV1Seed,
  IdlV1Type,
  IdlV1TypeDef,
} from "./types";

/** A 1.x IDL the 0.29 client cannot call faithfully; `message` is the reason */
export class IdlRefusal extends Error {}

/** A generic parameter's value: a type, or a const such as an array length */
type GenericValue = { type: IdlType } | { const: string };
type Env = Record<string, GenericValue>;

/** `pool_state` -> `poolState`, as `anchor-syn` 0.29 named things */
const camel = (s: string) =>
  s.replace(/_+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());

const sameBytes = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((x, i) => x === b[i]);

/** The primitive types the 0.29 coder encodes */
const PRIMITIVES = new Set([
  "bool",
  "u8",
  "i8",
  "u16",
  "i16",
  "u32",
  "i32",
  "f32",
  "u64",
  "i64",
  "f64",
  "u128",
  "i128",
  "u256",
  "i256",
  "bytes",
  "string",
]);

/** The 8 bytes the 0.29 coder puts in front of an instruction named `name` */
const sighash029 = (name: string) =>
  new BorshInstructionCoder({
    version: "0.0.0",
    name: "probe",
    instructions: [{ name, accounts: [], args: [] }],
  })
    .encode(name, {})
    .subarray(0, 8);

/**
 * Turns an Anchor 1.x IDL into the 0.29 shape. Throws `IdlRefusal` when the
 * 0.29 coder would not produce the program's own bytes.
 */
export const toLegacyIdl = (src: IdlV1): Idl => {
  const defs = new Map((src.types ?? []).map((t) => [t.name, t]));

  /** Emitted type definitions, by their 0.29 name */
  const out = new Map<string, IdlTypeDef>();

  const showType = (t: IdlType): string => {
    if (typeof t === "string") return t;
    if ("defined" in t) return t.defined;
    if ("option" in t) return `Option<${showType(t.option)}>`;
    if ("coption" in t) return `COption<${showType(t.coption)}>`;
    if ("vec" in t) return `Vec<${showType(t.vec)}>`;
    return `[${showType(t.array[0])}; ${t.array[1]}]`;
  };

  const resolveArg = (arg: IdlV1GenericArg, env: Env): GenericValue => {
    if (arg.kind === "const") return { const: arg.value };
    // Anchor writes a const parameter passed on as `{ kind: "type", type:
    // { generic: "N" } }`, so a type argument may resolve to a const
    if (typeof arg.type === "object" && "generic" in arg.type) {
      return lookup(arg.type.generic, env);
    }
    return { type: convertType(arg.type, env) };
  };

  const lookup = (name: string, env: Env): GenericValue => {
    const value = env[name];
    if (!value) throw new IdlRefusal(`an unbound generic ${name}`);
    return value;
  };

  const instantiate = (
    name: string,
    args: IdlV1GenericArg[] | undefined,
    env: Env
  ): IdlType => {
    const def = defs.get(name);
    if (!def) throw new IdlRefusal(`an unknown type ${name}`);
    const values = (args ?? []).map((a) => resolveArg(a, env));
    const params = def.generics ?? [];
    if (params.length !== values.length) {
      throw new IdlRefusal(`wrong generic arguments for ${name}`);
    }
    const inner: Env = Object.fromEntries(
      params.map((p, i) => [p.name, values[i]])
    );
    // Aliases are inlined: the Interact form reads no alias definitions
    if (def.type.kind === "type") return convertType(def.type.alias, inner);

    const legacyName = params.length
      ? `${name}<${values
          .map((v) => ("const" in v ? v.const : showType(v.type)))
          .join(", ")}>`
      : name;
    if (!out.has(legacyName)) {
      // Reserve the name first: a recursive type refers to itself
      out.set(legacyName, {
        name: legacyName,
        type: { kind: "struct", fields: [] },
      });
      out.set(legacyName, convertTypeDef(def, legacyName, inner));
    }
    return { defined: legacyName };
  };

  const convertType = (t: IdlV1Type, env: Env): IdlType => {
    if (typeof t === "string") {
      if (t === "pubkey") return "publicKey";
      if (!PRIMITIVES.has(t)) throw new IdlRefusal(`an unknown type ${t}`);
      return t as IdlType;
    }
    if ("generic" in t) {
      const value = lookup(t.generic, env);
      if ("const" in value) {
        throw new IdlRefusal(`a const generic ${t.generic} used as a type`);
      }
      return value.type;
    }
    if ("option" in t) return { option: convertType(t.option, env) };
    if ("coption" in t) return { coption: convertType(t.coption, env) };
    if ("vec" in t) return { vec: convertType(t.vec, env) };
    if ("array" in t) {
      const [item, len] = t.array;
      let size: number;
      if (typeof len === "number") size = len;
      else {
        const value = lookup(len.generic, env);
        if (!("const" in value)) {
          throw new IdlRefusal(
            `a type generic ${len.generic} used as a length`
          );
        }
        size = Number(value.const);
      }
      return { array: [convertType(item, env), size] };
    }
    return instantiate(t.defined.name, t.defined.generics, env);
  };

  const isNamed = (fields: IdlV1DefinedFields): fields is IdlV1Field[] =>
    fields.length > 0 &&
    typeof fields[0] === "object" &&
    fields[0] !== null &&
    "name" in fields[0] &&
    "type" in fields[0];

  /** Struct fields; tuple fields are named `0`, `1`, ... */
  const convertFields = (
    fields: IdlV1DefinedFields | undefined,
    env: Env
  ): IdlField[] => {
    if (!fields?.length) return [];
    if (isNamed(fields)) {
      return fields.map((f) => ({
        name: camel(f.name),
        ...(f.docs && { docs: f.docs }),
        type: convertType(f.type, env),
      }));
    }
    return (fields as IdlV1Type[]).map((t, i) => ({
      name: String(i),
      type: convertType(t, env),
    }));
  };

  const convertTypeDef = (
    def: IdlV1TypeDef,
    name: string,
    env: Env
  ): IdlTypeDef => {
    const docs = def.docs && { docs: def.docs };
    if (def.type.kind === "enum") {
      const variants: IdlEnumVariant[] = def.type.variants.map((v) => {
        if (!v.fields?.length) return { name: v.name };
        return isNamed(v.fields)
          ? { name: v.name, fields: convertFields(v.fields, env) }
          : {
              name: v.name,
              fields: (v.fields as IdlV1Type[]).map((t) => convertType(t, env)),
            };
      });
      return { name, ...docs, type: { kind: "enum", variants } };
    }
    if (def.type.kind === "type") {
      return {
        name,
        ...docs,
        type: { kind: "alias", value: convertType(def.type.alias, env) },
      };
    }
    return {
      name,
      ...docs,
      type: { kind: "struct", fields: convertFields(def.type.fields, env) },
    };
  };

  // Discriminators first: a custom one refuses the IDL before any mapping
  const ixNames = checkDiscriminators(src);

  // Every type that takes no parameters is emitted in IDL order; a generic
  // one only where it is used, once per argument list
  for (const def of src.types ?? []) {
    if (!def.generics?.length && def.type.kind !== "type") {
      instantiate(def.name, undefined, {});
    }
  }

  const ixs = src.instructions.map((ix) => convertInstruction(ix));

  function convertInstruction(ix: IdlV1Instruction) {
    const args = ix.args.map((a) => ({
      name: camel(a.name),
      ...(a.docs && { docs: a.docs }),
      type: convertType(a.type, {}),
    }));
    return {
      name: ixNames.get(ix.name)!,
      ...(ix.docs && { docs: ix.docs }),
      accounts: ix.accounts.map((a) => convertAccount(a, ix)),
      args,
      ...(ix.returns !== undefined && {
        returns: convertType(ix.returns, {}),
      }),
    };
  }

  /** A seed typed from the instruction, or `null` when it cannot be */
  function convertSeed(seed: IdlV1Seed, ix: IdlV1Instruction): IdlSeed | null {
    if (seed.kind === "const") return constSeed(seed.value);
    // `account` names the type whose data the path reads: the generator
    // fills a seed from an account's address only
    if (seed.kind === "account" && seed.account) return null;
    // The generator fills a seed from an argument or an account by name;
    // a path into an argument's or an account's data it cannot follow
    if (seed.path.includes(".")) return null;
    if (seed.kind === "arg") {
      const arg = ix.args.find((a) => a.name === seed.path);
      if (!arg) return null;
      return {
        kind: "arg",
        type: convertType(arg.type, {}),
        path: camel(seed.path),
      };
    }
    return { kind: "account", type: "publicKey", path: camel(seed.path) };
  }

  function convertAccount(
    item: IdlV1AccountItem,
    ix: IdlV1Instruction
  ): IdlAccountItem {
    const docs = item.docs && { docs: item.docs };
    if ("accounts" in item) {
      return {
        name: camel(item.name),
        ...docs,
        accounts: item.accounts.map((a) => convertAccount(a, ix)),
      };
    }
    let pda;
    if (item.pda) {
      const seeds = item.pda.seeds.map((s) => convertSeed(s, ix));
      const program = item.pda.program && convertSeed(item.pda.program, ix);
      // A seed the generator cannot fill leaves the account to the person
      if (seeds.every(Boolean) && program !== null) {
        pda = { seeds, ...(program && { programId: program }) };
      }
    }
    return {
      name: camel(item.name),
      isMut: !!item.writable,
      isSigner: !!item.signer,
      ...(item.optional && { isOptional: true }),
      ...docs,
      ...(item.relations && { relations: item.relations.map(camel) }),
      ...(pda && { pda }),
      // Not a 0.29 field: the form pre-fills an account with a fixed address
      ...(item.address && { address: item.address }),
    } as IdlAccountItem;
  }

  // An account type used inside another type stays in `types` too, where
  // the 0.29 accounts, types and events coders look it up. The instruction
  // coder looks in `accounts` and `types` together and wants one match, so
  // one an argument also reaches keeps only its `types` entry: the program
  // stays callable, and that account is not decoded by name
  const usedInTypes = typesUsedInFields(src);
  const reached = reachedFrom(
    ixs.flatMap((ix) => ix.args.map((a) => a.type)),
    out
  );
  const accounts = (src.accounts ?? []).flatMap((a) => {
    const def = out.get(a.name);
    if (!def || def.type.kind !== "struct") {
      throw new IdlRefusal(`an account ${a.name} without a struct type`);
    }
    if (usedInTypes.has(a.name) && reached.has(a.name)) return [];
    if (!usedInTypes.has(a.name)) out.delete(a.name);
    return [
      { name: a.name, ...(def.docs && { docs: def.docs }), type: def.type },
    ];
  });

  const events = (src.events ?? []).map((e) => {
    const def = out.get(e.name);
    if (!def || def.type.kind !== "struct") {
      throw new IdlRefusal(`an event ${e.name} without a struct type`);
    }
    const fields: IdlEventField[] = def.type.fields.map((f) => ({
      name: f.name,
      type: f.type,
      index: false,
    }));
    return { name: e.name, fields };
  });

  return {
    version: src.metadata.version,
    name: src.metadata.name,
    ...(src.docs && { docs: src.docs }),
    instructions: ixs,
    ...(src.accounts && { accounts }),
    ...(src.events && { events }),
    ...(src.errors && { errors: src.errors }),
    ...(out.size > 0 || src.types ? { types: [...out.values()] } : {}),
    ...(src.constants && {
      constants: src.constants.map((c) => ({
        name: c.name,
        type: convertType(c.type, {}),
        value: c.value,
      })),
    }),
    ...(src.address && { metadata: { address: src.address } }),
  } as Idl;
};

/**
 * Refuses an IDL whose discriminators the 0.29 coder would not reproduce.
 *
 * @returns each instruction's 0.29 name: camelCase as `anchor-syn` 0.29 wrote
 * it, or the name as written when camelCase does not hash back to the same
 * bytes (`add_2_things` -> `add2Things` -> `add2_things`)
 */
const checkDiscriminators = (src: IdlV1) => {
  const names = new Map<string, string>();
  for (const ix of src.instructions) {
    const name = [camel(ix.name), ix.name].find((n) =>
      sameBytes(sighash029(n), ix.discriminator)
    );
    if (!name) throw new IdlRefusal(`a custom discriminator on ${ix.name}`);
    // 0.29 keys `program.methods` by camelCase: two names that meet there
    // would leave one instruction unreachable
    if ([...names.values()].some((n) => camel(n) === camel(name))) {
      throw new IdlRefusal(`two instructions named ${camel(name)}`);
    }
    names.set(ix.name, name);
  }
  for (const a of src.accounts ?? []) {
    const own = BorshAccountsCoder.accountDiscriminator(a.name);
    if (!sameBytes(own, a.discriminator)) {
      throw new IdlRefusal(`a custom discriminator on ${a.name}`);
    }
  }
  for (const e of src.events ?? []) {
    if (!sameBytes(eventDiscriminator(e.name), e.discriminator)) {
      throw new IdlRefusal(`a custom discriminator on ${e.name}`);
    }
  }
  return names;
};

/** A const seed as the generator shows it: text, an address, or bytes */
const constSeed = (bytes: number[]): IdlSeed => {
  const text = printable(bytes);
  // Text the generator's `string` parse would change (it drops quotes) goes
  // as bytes, so the PDA derives from the program's own bytes
  if (text !== null && !/["']/.test(text) && text.trim() === text) {
    return { kind: "const", type: "string", value: text };
  }
  if (bytes.length === 32) {
    return {
      kind: "const",
      type: "publicKey",
      value: new PublicKey(Uint8Array.from(bytes)).toBase58(),
    };
  }
  return { kind: "const", type: "bytes", value: JSON.stringify(bytes) };
};

/** The bytes as text when they are printable UTF-8, else `null` */
const printable = (bytes: number[]): string | null => {
  if (!bytes.length) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes)
    );
    return /^[^\p{Cc}\p{Cf}]+$/u.test(text) ? text : null;
  } catch {
    // `fatal` throws on bytes that are not UTF-8: they are shown as bytes
    return null;
  }
};

/** Names of types referenced from inside a type definition's fields */
const typesUsedInFields = (src: IdlV1) => {
  const used = new Set<string>();
  for (const def of src.types ?? []) collectDefined(def.type, used);
  return used;
};

/** Names of every type the given types refer to, following definitions */
const reachedFrom = (roots: IdlType[], defs: Map<string, IdlTypeDef>) => {
  const seen = new Set<string>();
  const queue: unknown[] = [...roots];
  while (queue.length) {
    const found = new Set<string>();
    collectLegacyDefined(queue.pop(), found);
    for (const name of found) {
      if (seen.has(name)) continue;
      seen.add(name);
      const def = defs.get(name);
      if (def) queue.push(def.type);
    }
  }
  return seen;
};

/** Names in 0.29 `{ defined: "Name" }` references, at any depth */
const collectLegacyDefined = (node: unknown, used: Set<string>) => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectLegacyDefined(n, used);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.defined === "string") used.add(obj.defined);
  for (const v of Object.values(obj)) collectLegacyDefined(v, used);
};

const collectDefined = (node: unknown, used: Set<string>) => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectDefined(n, used);
    return;
  }
  const obj = node as Record<string, unknown>;
  const defined = obj.defined as { name?: unknown } | undefined;
  if (defined && typeof defined.name === "string") used.add(defined.name);
  for (const v of Object.values(obj)) collectDefined(v, used);
};
