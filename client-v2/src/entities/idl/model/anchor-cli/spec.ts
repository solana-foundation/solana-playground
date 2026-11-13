import type {
  IdlV1,
  IdlV1Account,
  IdlV1AccountItem,
  IdlV1Accounts,
  IdlV1DefinedFields,
  IdlV1Deployments,
  IdlV1Discriminated,
  IdlV1Field,
  IdlV1Generic,
  IdlV1GenericArg,
  IdlV1Instruction,
  IdlV1Repr,
  IdlV1Seed,
  IdlV1Type,
  IdlV1TypeDef,
  IdlV1TypeDefTy,
} from "../types";
import {
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
  defaulted,
  type Field,
  flag,
  isRecord,
  list,
  mapWith,
  ok,
  optional,
  rejected,
  required,
  wrapWith,
} from "./decode";

/** An {@link IdlV1} as Anchor's `Idl` deserialises it: `address` is required */
export type AnchorIdl = IdlV1 & { address: string };

/** The spec Anchor 1.1.2 writes, `IDL_SPEC` of its `anchor-lang-idl-spec` crate */
export const IDL_SPEC = "0.1.0";

/** The types both specs spell alike; the address type is `pubkey` in one and `publicKey` in the other */
export const PRIMITIVE_TYPES = [
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
];

type Metadata = IdlV1["metadata"];
type Dependency = NonNullable<Metadata["dependencies"]>[number];
type ErrorCode = NonNullable<IdlV1["errors"]>[number];
type Const = NonNullable<IdlV1["constants"]>[number];
type Pda = NonNullable<IdlV1Account["pda"]>;
type Defined = Extract<IdlV1Type, { defined: unknown }>["defined"];
type ArrayLength = Extract<IdlV1Type, { array: unknown }>["array"][1];
type Variant = Extract<IdlV1TypeDefTy, { kind: "enum" }>["variants"][number];

const decodeGeneric: Decoder<{ generic: string }> = (json) =>
  isRecord(json) &&
  Object.keys(json).length === 1 &&
  typeof json.generic === "string"
    ? ok({ generic: json.generic })
    : rejected("is not a generic");

const decodeArrayLength = decodeUntaggedWith<ArrayLength>([
  decodeGeneric,
  decodeUsize,
]);

const decodeGenericArg: Decoder<IdlV1GenericArg> = decodeTaggedWith({
  type: decodeRecordWith<{ type: IdlV1Type }>({
    type: required((json) => decodeType(json)),
  }),
  const: decodeRecordWith<{ value: string }>({
    value: required(decodeString),
  }),
});

const decodeDefined = decodeRecordWith<Defined>({
  name: required(decodeString),
  generics: list(decodeGenericArg),
});

const decodeType: Decoder<IdlV1Type> = decodeEnumWith<IdlV1Type, string>(
  new Set([...PRIMITIVE_TYPES, "pubkey"]),
  {
    option: (json) => wrapWith("option")(decodeType(json)),
    vec: (json) => wrapWith("vec")(decodeType(json)),
    array: (json) =>
      wrapWith("array")(decodePairWith(decodeType, decodeArrayLength)(json)),
    defined: (json) => wrapWith("defined")(decodeDefined(json)),
    generic: (json) => wrapWith("generic")(decodeString(json)),
  }
);

const decodeField = decodeRecordWith<IdlV1Field>({
  name: required(decodeString),
  docs: list(decodeString),
  type: required(decodeType),
});

const fields: Field<IdlV1DefinedFields | undefined> = optional(
  decodeUntaggedWith<IdlV1DefinedFields>([
    decodeListWith(decodeField),
    decodeListWith(decodeType),
  ])
);

const decodeSeed: Decoder<IdlV1Seed> = decodeTaggedWith({
  const: decodeRecordWith<{ value: number[] }>({
    value: required(decodeListWith(decodeU8)),
  }),
  arg: decodeRecordWith<{ path: string }>({ path: required(decodeString) }),
  account: decodeRecordWith<{ path: string; account?: string }>({
    path: required(decodeString),
    account: optional(decodeString),
  }),
});

const decodeAccount = decodeRecordWith<IdlV1Account>({
  name: required(decodeString),
  docs: list(decodeString),
  writable: flag,
  signer: flag,
  optional: flag,
  address: optional(decodeString),
  pda: optional(
    decodeRecordWith<Pda>({
      seeds: required(decodeListWith(decodeSeed)),
      program: optional(decodeSeed),
    })
  ),
  relations: list(decodeString),
});

// Anchor's `IdlInstructionAccounts` has no `docs`
const decodeAccounts = decodeRecordWith<Omit<IdlV1Accounts, "docs">>({
  name: required(decodeString),
  accounts: required(decodeListWith((json) => decodeAccountItem(json))),
});

const decodeAccountItem: Decoder<IdlV1AccountItem> =
  decodeUntaggedWith<IdlV1AccountItem>([decodeAccounts, decodeAccount]);

const decodeInstruction = decodeRecordWith<IdlV1Instruction>({
  name: required(decodeString),
  docs: list(decodeString),
  discriminator: required(decodeListWith(decodeU8)),
  accounts: required(decodeListWith(decodeAccountItem)),
  args: required(decodeListWith(decodeField)),
  returns: optional(decodeType),
});

const decodeDiscriminated = decodeRecordWith<IdlV1Discriminated>({
  name: required(decodeString),
  discriminator: required(decodeListWith(decodeU8)),
});

const decodeSerialization = decodeEnumWith<{ custom: string }, string>(
  new Set(["borsh", "bytemuck", "bytemuckunsafe"]),
  { custom: (json) => wrapWith("custom")(decodeString(json)) }
);

/** Borsh is the default, so serde leaves it out */
const serialization: Field<IdlV1TypeDef["serialization"]> = defaulted((json) =>
  mapWith((value: string | { custom: string }) =>
    value === "borsh" ? undefined : value
  )(decodeSerialization(json))
);

const decodeReprModifier = decodeRecordWith<{
  packed?: boolean;
  align?: number;
}>({ packed: flag, align: optional(decodeUsize) });

const decodeRepr: Decoder<IdlV1Repr> = decodeTaggedWith({
  rust: decodeReprModifier,
  c: decodeReprModifier,
  transparent: decodeRecordWith<Record<string, never>>({}),
});

const decodeTypeDefGeneric: Decoder<IdlV1Generic> = decodeTaggedWith({
  type: decodeRecordWith<{ name: string }>({ name: required(decodeString) }),
  const: decodeRecordWith<{ name: string; type: string }>({
    name: required(decodeString),
    type: required(decodeString),
  }),
});

const decodeTypeDefTy: Decoder<IdlV1TypeDefTy> = decodeTaggedWith({
  struct: decodeRecordWith<{ fields?: IdlV1DefinedFields }>({ fields }),
  enum: decodeRecordWith<{ variants: Variant[] }>({
    variants: required(
      decodeListWith(
        decodeRecordWith<Variant>({ name: required(decodeString), fields })
      )
    ),
  }),
  type: decodeRecordWith<{ alias: IdlV1Type }>({
    alias: required(decodeType),
  }),
});

const decodeTypeDef = decodeRecordWith<IdlV1TypeDef>({
  name: required(decodeString),
  docs: list(decodeString),
  serialization,
  repr: optional(decodeRepr),
  generics: list(decodeTypeDefGeneric),
  type: required(decodeTypeDefTy),
});

// eslint-disable-next-line unicorn/no-null -- serde writes a cluster without a deployment as `null`
const NO_DEPLOYMENT = null;

/** Not skipped when `None`, unlike every other `Option` of the spec */
const deployment: Field<string | null> = {
  decode: (json) => (json === null ? ok(NO_DEPLOYMENT) : decodeString(json)),
  absent: ok(NO_DEPLOYMENT),
};

const decodeMetadata = decodeRecordWith<Metadata>({
  name: required(decodeString),
  version: required(decodeString),
  spec: required(decodeString),
  description: optional(decodeString),
  repository: optional(decodeString),
  dependencies: list(
    decodeRecordWith<Dependency>({
      name: required(decodeString),
      version: required(decodeString),
    })
  ),
  contact: optional(decodeString),
  deployments: optional(
    decodeRecordWith<IdlV1Deployments>({
      mainnet: deployment,
      testnet: deployment,
      devnet: deployment,
      localnet: deployment,
    })
  ),
});

/** Anchor's `Idl` of the current spec, with the keys in the order serde writes them and every default left out */
export const decodeIdl = decodeRecordWith<AnchorIdl>({
  address: required(decodeString),
  metadata: required(decodeMetadata),
  docs: list(decodeString),
  instructions: required(decodeListWith(decodeInstruction)),
  accounts: list(decodeDiscriminated),
  events: list(decodeDiscriminated),
  errors: list(
    decodeRecordWith<ErrorCode>({
      code: required(decodeU32),
      name: required(decodeString),
      msg: optional(decodeString),
    })
  ),
  types: list(decodeTypeDef),
  constants: list(
    decodeRecordWith<Const>({
      name: required(decodeString),
      docs: list(decodeString),
      type: required(decodeType),
      value: required(decodeString),
    })
  ),
});
