import type {
  IdlV1Account,
  IdlV1AccountItem,
  IdlV1DefinedFields,
  IdlV1Field,
  IdlV1GenericArg,
  IdlV1Instruction,
  IdlV1Seed,
  IdlV1Type,
  IdlV1TypeDef,
  IdlV1TypeDefTy,
} from "../types";
import {
  decodeAny,
  decodeBool,
  decodeEnumWith,
  decodeListWith,
  decodePairWith,
  type Decoder,
  decodeRecordWith,
  decodeString,
  decodeTaggedWith,
  decodeU8,
  decodeU32,
  decodeUntaggedWith,
  decodeUsize,
  isNamed,
  isRecord,
  list,
  nonEmpty,
  optional,
  required,
  wrapWith,
} from "./decode";
import { heckMixedCase, heckSnakeCase } from "./heck";
import { type AnchorIdl, IDL_SPEC, PRIMITIVE_TYPES } from "./spec";

/**
 * The legacy IDL (before Anchor 0.30) as the `legacy` module of Anchor 1.1.2's
 * converter defines it: the 0.29 `Idl` of `@coral-xyz/anchor` plus generics.
 */
export interface LegacyIdl {
  version: string;
  name: string;
  docs?: string[];
  constants?: LegacyConst[];
  instructions: LegacyInstruction[];
  accounts?: LegacyTypeDef[];
  types?: LegacyTypeDef[];
  events?: LegacyEvent[];
  errors?: LegacyErrorCode[];
  metadata?: unknown;
}

interface LegacyConst {
  name: string;
  type: LegacyType;
  value: string;
}

interface LegacyInstruction {
  name: string;
  docs?: string[];
  accounts: LegacyAccountItem[];
  args: LegacyField[];
  returns?: LegacyType;
}

type LegacyAccountItem = LegacyAccount | LegacyAccounts;

interface LegacyAccount {
  name: string;
  isMut: boolean;
  isSigner: boolean;
  isOptional?: boolean;
  docs?: string[];
  pda?: LegacyPda;
  relations?: string[];
}

interface LegacyAccounts {
  name: string;
  accounts: LegacyAccountItem[];
}

interface LegacyPda {
  seeds: LegacySeed[];
  programId?: LegacySeed;
}

type LegacySeed =
  | { kind: "const"; type: LegacyType; value: unknown }
  | { kind: "arg"; type: LegacyType; path: string }
  | { kind: "account"; type: LegacyType; account?: string; path: string };

interface LegacyField {
  name: string;
  docs?: string[];
  type: LegacyType;
}

interface LegacyEvent {
  name: string;
  fields: LegacyEventField[];
}

interface LegacyEventField {
  name: string;
  type: LegacyType;
  index: boolean;
}

interface LegacyTypeDef {
  name: string;
  docs?: string[];
  generics?: string[];
  type: LegacyTypeDefTy;
}

type LegacyFields = LegacyField[] | LegacyType[];

interface LegacyVariant {
  name: string;
  fields?: LegacyFields;
}

type LegacyTypeDefTy =
  | { kind: "struct"; fields: LegacyField[] }
  | { kind: "enum"; variants: LegacyVariant[] }
  | { kind: "alias"; value: LegacyType };

type LegacyType =
  | string
  | { defined: string }
  | { option: LegacyType }
  | { vec: LegacyType }
  | { array: [LegacyType, number] }
  | { genericLenArray: [LegacyType, string] }
  | { generic: string }
  | { definedWithTypeArgs: LegacyDefined };

interface LegacyDefined {
  name: string;
  args: LegacyTypeArg[];
}

type LegacyTypeArg =
  | { generic: string }
  | { value: string }
  | { type: LegacyType };

interface LegacyErrorCode {
  code: number;
  name: string;
  msg?: string;
}

const decodeTypeArg: Decoder<LegacyTypeArg> = decodeEnumWith<
  LegacyTypeArg,
  never
>(new Set<never>(), {
  generic: (json) => wrapWith("generic")(decodeString(json)),
  value: (json) => wrapWith("value")(decodeString(json)),
  type: (json) => wrapWith("type")(decodeType(json)),
});

const decodeDefined = decodeRecordWith<LegacyDefined>({
  name: required(decodeString),
  args: required(decodeListWith(decodeTypeArg)),
});

const decodeType: Decoder<LegacyType> = decodeEnumWith<LegacyType, string>(
  new Set([...PRIMITIVE_TYPES, "publicKey"]),
  {
    defined: (json) => wrapWith("defined")(decodeString(json)),
    option: (json) => wrapWith("option")(decodeType(json)),
    vec: (json) => wrapWith("vec")(decodeType(json)),
    array: (json) =>
      wrapWith("array")(decodePairWith(decodeType, decodeUsize)(json)),
    genericLenArray: (json) =>
      wrapWith("genericLenArray")(
        decodePairWith(decodeType, decodeString)(json)
      ),
    generic: (json) => wrapWith("generic")(decodeString(json)),
    definedWithTypeArgs: (json) =>
      wrapWith("definedWithTypeArgs")(decodeDefined(json)),
  }
);

const docs = optional(decodeListWith(decodeString));

const decodeField = decodeRecordWith<LegacyField>({
  name: required(decodeString),
  docs,
  type: required(decodeType),
});

const decodeSeed: Decoder<LegacySeed> = decodeTaggedWith({
  const: decodeRecordWith<{ type: LegacyType; value: unknown }>({
    type: required(decodeType),
    value: required(decodeAny),
  }),
  arg: decodeRecordWith<{ type: LegacyType; path: string }>({
    type: required(decodeType),
    path: required(decodeString),
  }),
  account: decodeRecordWith<{
    type: LegacyType;
    account?: string;
    path: string;
  }>({
    type: required(decodeType),
    account: optional(decodeString),
    path: required(decodeString),
  }),
});

const decodeAccount = decodeRecordWith<LegacyAccount>({
  name: required(decodeString),
  isMut: required(decodeBool),
  isSigner: required(decodeBool),
  isOptional: optional(decodeBool),
  docs,
  pda: optional(
    decodeRecordWith<LegacyPda>({
      seeds: required(decodeListWith(decodeSeed)),
      programId: optional(decodeSeed),
    })
  ),
  relations: list(decodeString),
});

const decodeAccounts = decodeRecordWith<LegacyAccounts>({
  name: required(decodeString),
  accounts: required(decodeListWith((json) => decodeAccountItem(json))),
});

const decodeAccountItem: Decoder<LegacyAccountItem> =
  decodeUntaggedWith<LegacyAccountItem>([decodeAccount, decodeAccounts]);

const decodeTypeDefTy: Decoder<LegacyTypeDefTy> = decodeTaggedWith({
  struct: decodeRecordWith<{ fields: LegacyField[] }>({
    fields: required(decodeListWith(decodeField)),
  }),
  enum: decodeRecordWith<{ variants: LegacyVariant[] }>({
    variants: required(
      decodeListWith(
        decodeRecordWith<LegacyVariant>({
          name: required(decodeString),
          fields: optional(
            decodeUntaggedWith<LegacyFields>([
              decodeListWith(decodeField),
              decodeListWith(decodeType),
            ])
          ),
        })
      )
    ),
  }),
  alias: decodeRecordWith<{ value: LegacyType }>({
    value: required(decodeType),
  }),
});

const decodeTypeDef = decodeRecordWith<LegacyTypeDef>({
  name: required(decodeString),
  docs,
  generics: optional(decodeListWith(decodeString)),
  type: required(decodeTypeDefTy),
});

/** Anchor's legacy `Idl` */
export const decodeLegacyIdl = decodeRecordWith<LegacyIdl>({
  version: required(decodeString),
  name: required(decodeString),
  docs,
  constants: list(
    decodeRecordWith<LegacyConst>({
      name: required(decodeString),
      type: required(decodeType),
      value: required(decodeString),
    })
  ),
  instructions: required(
    decodeListWith(
      decodeRecordWith<LegacyInstruction>({
        name: required(decodeString),
        docs,
        accounts: required(decodeListWith(decodeAccountItem)),
        args: required(decodeListWith(decodeField)),
        returns: optional(decodeType),
      })
    )
  ),
  accounts: list(decodeTypeDef),
  types: list(decodeTypeDef),
  events: optional(
    decodeListWith(
      decodeRecordWith<LegacyEvent>({
        name: required(decodeString),
        fields: required(
          decodeListWith(
            decodeRecordWith<LegacyEventField>({
              name: required(decodeString),
              type: required(decodeType),
              index: required(decodeBool),
            })
          )
        ),
      })
    )
  ),
  errors: optional(
    decodeListWith(
      decodeRecordWith<LegacyErrorCode>({
        code: required(decodeU32),
        name: required(decodeString),
        msg: optional(decodeString),
      })
    )
  ),
  metadata: optional(decodeAny),
});

/** Anchor's `recase_path`: a seed path or a relation names accounts and fields, joined by dots */
const recaseWith = (recase: (name: string) => string) => (path: string) =>
  path.split(".").map(recase).join(".");

const toSnakePath = recaseWith(heckSnakeCase);
const toMixedPath = recaseWith(heckMixedCase);

/** Anchor's `get_disc`: the first 8 bytes of `sha256("<prefix>:<name>")` */
const discriminatorFor =
  (prefix: string) =>
  async (name: string): Promise<number[]> => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${prefix}:${name}`)
    );
    return Array.from(new Uint8Array(digest, 0, 8));
  };

const discriminatedFor =
  (prefix: string) =>
  async ({ name }: { name: string }) => ({
    name,
    discriminator: await discriminatorFor(prefix)(name),
  });

const typeArgFromLegacy = (arg: LegacyTypeArg): IdlV1GenericArg => {
  if ("value" in arg) return { kind: "const", value: arg.value };
  return {
    kind: "type",
    type: "type" in arg ? typeFromLegacy(arg.type) : arg,
  };
};

const typeFromLegacy = (type: LegacyType): IdlV1Type => {
  if (typeof type === "string") return type === "publicKey" ? "pubkey" : type;
  if ("defined" in type) return { defined: { name: type.defined } };
  if ("definedWithTypeArgs" in type) {
    const { name, args } = type.definedWithTypeArgs;
    return {
      defined: { name, generics: nonEmpty(args.map(typeArgFromLegacy)) },
    };
  }
  if ("option" in type) return { option: typeFromLegacy(type.option) };
  if ("vec" in type) return { vec: typeFromLegacy(type.vec) };
  if ("array" in type) {
    return { array: [typeFromLegacy(type.array[0]), type.array[1]] };
  }
  if ("genericLenArray" in type) {
    const [item, generic] = type.genericLenArray;
    return { array: [typeFromLegacy(item), { generic }] };
  }
  return type;
};

const fieldFromLegacy = (field: LegacyField): IdlV1Field => ({
  name: heckSnakeCase(field.name),
  docs: nonEmpty(field.docs),
  type: typeFromLegacy(field.type),
});

/** A const seed's bytes. Anchor takes the JSON text of a `string` seed, so its bytes hold the quotes */
const constSeedBytes = ({
  type,
  value,
}: {
  type: LegacyType;
  value: unknown;
}) => {
  if (type === "string") {
    return Array.from(new TextEncoder().encode(JSON.stringify(value)));
  }
  if (type !== "bytes") {
    throw new Error(
      `Const seed conversion not supported for type ${JSON.stringify(type)}`
    );
  }
  const bytes = decodeListWith(decodeU8)(value);
  if (!bytes.ok) {
    throw new Error(
      "Const seed of type `bytes` must be a JSON array of u8 values"
    );
  }
  return bytes.value;
};

const seedFromLegacy = (seed: LegacySeed): IdlV1Seed => {
  if (seed.kind === "const") {
    return { kind: "const", value: constSeedBytes(seed) };
  }
  if (seed.kind === "arg") {
    return { kind: "arg", path: toSnakePath(seed.path) };
  }
  return {
    kind: "account",
    path: toSnakePath(seed.path),
    account: seed.account,
  };
};

const accountItemFromLegacy = (item: LegacyAccountItem): IdlV1AccountItem => {
  if (!("isMut" in item)) {
    return {
      name: heckSnakeCase(item.name),
      accounts: item.accounts.map(accountItemFromLegacy),
    };
  }
  return {
    name: heckSnakeCase(item.name),
    docs: nonEmpty(item.docs),
    writable: item.isMut || undefined,
    signer: item.isSigner || undefined,
    optional: item.isOptional || undefined,
    pda: item.pda && {
      seeds: item.pda.seeds.map(seedFromLegacy),
      program: item.pda.programId && seedFromLegacy(item.pda.programId),
    },
    relations: nonEmpty((item.relations ?? []).map(toSnakePath)),
  };
};

const instructionFromLegacy = async (
  ix: LegacyInstruction
): Promise<IdlV1Instruction> => {
  const name = heckSnakeCase(ix.name);
  return {
    name,
    docs: nonEmpty(ix.docs),
    discriminator: await discriminatorFor("global")(name),
    accounts: ix.accounts.map(accountItemFromLegacy),
    args: ix.args.map(fieldFromLegacy),
    returns: ix.returns === undefined ? undefined : typeFromLegacy(ix.returns),
  };
};

const fieldsFromLegacy = (fields: LegacyFields): IdlV1DefinedFields =>
  isNamed<LegacyField, LegacyType>(fields)
    ? fields.map(fieldFromLegacy)
    : fields.map(typeFromLegacy);

const typeDefTyFromLegacy = (ty: LegacyTypeDefTy): IdlV1TypeDefTy => {
  if (ty.kind === "struct") {
    return { kind: "struct", fields: nonEmpty(ty.fields.map(fieldFromLegacy)) };
  }
  if (ty.kind === "alias") {
    return { kind: "type", alias: typeFromLegacy(ty.value) };
  }
  return {
    kind: "enum",
    variants: ty.variants.map(({ name, fields }) => ({
      name,
      fields: fields && fieldsFromLegacy(fields),
    })),
  };
};

// Anchor drops a legacy definition's `generics`
const typeDefFromLegacy = (def: LegacyTypeDef): IdlV1TypeDef => ({
  name: def.name,
  docs: nonEmpty(def.docs),
  type: typeDefTyFromLegacy(def.type),
});

// An event's fields stay a list when empty, where a struct's are left out
const typeDefFromEvent = (event: LegacyEvent): IdlV1TypeDef => ({
  name: event.name,
  type: {
    kind: "struct",
    fields: event.fields.map(({ name, type }) => ({
      name: heckSnakeCase(name),
      type: typeFromLegacy(type),
    })),
  },
});

/** Anchor's `impl TryFrom<legacy::Idl> for Idl`; throws when Anchor refuses the conversion */
export const idlFromLegacy = async (legacy: LegacyIdl): Promise<AnchorIdl> => {
  const address = isRecord(legacy.metadata)
    ? legacy.metadata.address
    : undefined;
  if (typeof address !== "string") {
    throw new Error("Program id missing in `idl.metadata.address` field");
  }
  const accounts = legacy.accounts ?? [];
  const events = legacy.events ?? [];
  return {
    address,
    metadata: { name: legacy.name, version: legacy.version, spec: IDL_SPEC },
    docs: nonEmpty(legacy.docs),
    instructions: await Promise.all(
      legacy.instructions.map(instructionFromLegacy)
    ),
    accounts: nonEmpty(
      await Promise.all(accounts.map(discriminatedFor("account")))
    ),
    events: nonEmpty(await Promise.all(events.map(discriminatedFor("event")))),
    errors: nonEmpty(legacy.errors),
    types: nonEmpty([
      ...(legacy.types ?? []).map(typeDefFromLegacy),
      ...accounts.map(typeDefFromLegacy),
      ...events.map(typeDefFromEvent),
    ]),
    constants: nonEmpty(
      (legacy.constants ?? []).map(({ name, type, value }) => ({
        name,
        type: typeFromLegacy(type),
        value,
      }))
    ),
  };
};

const typeArgToLegacy = (arg: IdlV1GenericArg): LegacyTypeArg => {
  if (arg.kind === "const") return { value: arg.value };
  return typeof arg.type === "object" && "generic" in arg.type
    ? arg.type
    : { type: typeToLegacy(arg.type) };
};

const typeToLegacy = (type: IdlV1Type): LegacyType => {
  if (typeof type === "string") return type === "pubkey" ? "publicKey" : type;
  if ("option" in type) return { option: typeToLegacy(type.option) };
  if ("vec" in type) return { vec: typeToLegacy(type.vec) };
  if ("array" in type) {
    const [item, length] = type.array;
    return typeof length === "number"
      ? { array: [typeToLegacy(item), length] }
      : { genericLenArray: [typeToLegacy(item), length.generic] };
  }
  if ("defined" in type) {
    const { name, generics } = type.defined;
    return generics
      ? { definedWithTypeArgs: { name, args: generics.map(typeArgToLegacy) } }
      : { defined: name };
  }
  if ("generic" in type) return type;
  throw new Error(
    `IDL type variant ${JSON.stringify(type)} has no legacy IDL equivalent`
  );
};

const fieldToLegacy = (field: IdlV1Field): LegacyField => ({
  name: heckMixedCase(field.name),
  docs: field.docs,
  type: typeToLegacy(field.type),
});

// The current spec keeps no seed type: Anchor writes `bytes` for a const and an argument, `publicKey` for an account
const seedToLegacy = (seed: IdlV1Seed): LegacySeed => {
  if (seed.kind === "const") {
    return { kind: "const", type: "bytes", value: seed.value };
  }
  if (seed.kind === "arg") {
    return { kind: "arg", type: "bytes", path: toMixedPath(seed.path) };
  }
  return {
    kind: "account",
    type: "publicKey",
    account: seed.account,
    path: toMixedPath(seed.path),
  };
};

const accountToLegacy = (account: IdlV1Account): LegacyAccount => ({
  name: heckMixedCase(account.name),
  isMut: account.writable ?? false,
  isSigner: account.signer ?? false,
  isOptional: account.optional || undefined,
  docs: account.docs,
  pda: account.pda && {
    seeds: account.pda.seeds.map(seedToLegacy),
    programId: account.pda.program && seedToLegacy(account.pda.program),
  },
  relations: account.relations?.map(toMixedPath),
});

const accountItemToLegacy = (item: IdlV1AccountItem): LegacyAccountItem =>
  "accounts" in item
    ? {
        name: heckMixedCase(item.name),
        accounts: item.accounts.map(accountItemToLegacy),
      }
    : accountToLegacy(item);

const fieldsToLegacy = (fields: IdlV1DefinedFields): LegacyFields =>
  isNamed<IdlV1Field, IdlV1Type>(fields)
    ? fields.map(fieldToLegacy)
    : fields.map(typeToLegacy);

const typeDefTyToLegacy = (ty: IdlV1TypeDefTy): LegacyTypeDefTy => {
  if (ty.kind === "type") {
    return { kind: "alias", value: typeToLegacy(ty.alias) };
  }
  if (ty.kind === "enum") {
    return {
      kind: "enum",
      variants: ty.variants.map(({ name, fields }) => ({
        name,
        fields: fields && fieldsToLegacy(fields),
      })),
    };
  }
  const structFields = ty.fields ?? [];
  if (!isNamed<IdlV1Field, IdlV1Type>(structFields)) {
    throw new Error("Tuple-style struct fields have no legacy IDL equivalent");
  }
  return { kind: "struct", fields: structFields.map(fieldToLegacy) };
};

const typeDefToLegacy = (def: IdlV1TypeDef): LegacyTypeDef => {
  if (def.serialization !== undefined) {
    const serialization = JSON.stringify(def.serialization);
    throw new Error(
      `Type \`${def.name}\` uses non-Borsh serialization (${serialization}); the legacy IDL spec only supports Borsh`
    );
  }
  const generics = def.generics?.map((generic) => {
    if (generic.kind === "const") {
      throw new Error(
        `Type \`${def.name}\` uses const generics; the legacy IDL spec only supports type generics`
      );
    }
    return generic.name;
  });
  return {
    name: def.name,
    docs: def.docs,
    generics,
    type: typeDefTyToLegacy(def.type),
  };
};

/** Anchor's `event_from_typedef`: the current spec keeps no `index`, so every field gets `false` */
const eventToLegacy = ({ name, type }: IdlV1TypeDef): LegacyEvent => {
  if (type.kind !== "struct") {
    throw new Error(
      `Event \`${name}\` must be defined as a struct in the current spec`
    );
  }
  const fields = type.fields ?? [];
  if (!isNamed<IdlV1Field, IdlV1Type>(fields)) {
    throw new Error(
      `Event \`${name}\` is a tuple struct; legacy IDLs require named fields`
    );
  }
  return {
    name,
    fields: fields.map((field) => ({
      name: heckMixedCase(field.name),
      type: typeToLegacy(field.type),
      index: false,
    })),
  };
};

/** Anchor's `to_legacy`; throws when the IDL holds what the legacy spec cannot */
export const legacyFromIdl = (idl: AnchorIdl): LegacyIdl => {
  const types = idl.types ?? [];
  const accounts = idl.accounts ?? [];
  const events = idl.events ?? [];
  const typeByName = new Map(types.map((def) => [def.name, def]));
  const typeListedIn = (section: string) => (name: string) => {
    const def = typeByName.get(name);
    if (!def) {
      throw new Error(
        `\`${name}\` is referenced in \`${section}\` but not defined in \`types\``
      );
    }
    return def;
  };
  // An account's or an event's type moves into the legacy `accounts` or `events`
  const moved = new Set([...accounts, ...events].map(({ name }) => name));
  const legacyAccounts = accounts.map(({ name }) =>
    typeDefToLegacy(typeListedIn("accounts")(name))
  );
  const legacyEvents = events.map(({ name }) =>
    eventToLegacy(typeListedIn("events")(name))
  );
  const legacyTypes = types
    .filter(({ name }) => !moved.has(name))
    .map(typeDefToLegacy);
  return {
    version: idl.metadata.version,
    name: idl.metadata.name,
    docs: idl.docs,
    constants: nonEmpty(
      (idl.constants ?? []).map(({ name, type, value }) => ({
        name,
        type: typeToLegacy(type),
        value,
      }))
    ),
    instructions: idl.instructions.map((ix) => ({
      name: heckMixedCase(ix.name),
      docs: ix.docs,
      accounts: ix.accounts.map(accountItemToLegacy),
      args: ix.args.map(fieldToLegacy),
      returns: ix.returns === undefined ? undefined : typeToLegacy(ix.returns),
    })),
    accounts: nonEmpty(legacyAccounts),
    types: nonEmpty(legacyTypes),
    events: nonEmpty(legacyEvents),
    errors: idl.errors,
    metadata: { address: idl.address },
  };
};
