import type { Idl } from "@coral-xyz/anchor";

/**
 * The Anchor IDL of spec `0.1.0`, as `anchor idl build` writes it from Anchor
 * 0.30 on, 1.x included.
 *
 * Declared here instead of taken from `@anchor-lang/core`, which the client
 * does not depend on; field for field it follows that package's `idl.ts` (1.2.2).
 */
export interface IdlV1 {
  /** Written from `declare_id!`; absent from an IDL edited by hand */
  address?: string;
  metadata: {
    name: string;
    version: string;
    spec: string;
    description?: string;
  };
  docs?: string[];
  instructions: IdlV1Instruction[];
  accounts?: IdlV1Discriminated[];
  events?: IdlV1Discriminated[];
  errors?: { code: number; name: string; msg?: string }[];
  types?: IdlV1TypeDef[];
  constants?: { name: string; type: IdlV1Type; value: string }[];
}

export interface IdlV1Instruction {
  name: string;
  docs?: string[];
  discriminator: number[];
  accounts: IdlV1AccountItem[];
  args: IdlV1Field[];
  returns?: IdlV1Type;
}

export type IdlV1AccountItem = IdlV1Account | IdlV1Accounts;

export interface IdlV1Account {
  name: string;
  docs?: string[];
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  pda?: { seeds: IdlV1Seed[]; program?: IdlV1Seed };
  relations?: string[];
}

export interface IdlV1Accounts {
  name: string;
  docs?: string[];
  accounts: IdlV1AccountItem[];
}

export type IdlV1Seed =
  | { kind: "const"; value: number[] }
  | { kind: "arg"; path: string }
  | { kind: "account"; path: string; account?: string };

export interface IdlV1Discriminated {
  name: string;
  discriminator: number[];
}

export interface IdlV1Field {
  name: string;
  docs?: string[];
  type: IdlV1Type;
}

export type IdlV1Generic =
  | { kind: "type"; name: string }
  | { kind: "const"; name: string; type: string };

export type IdlV1GenericArg =
  | { kind: "type"; type: IdlV1Type }
  | { kind: "const"; value: string };

export interface IdlV1TypeDef {
  name: string;
  docs?: string[];
  serialization?: string;
  repr?: unknown;
  generics?: IdlV1Generic[];
  type: IdlV1TypeDefTy;
}

export type IdlV1DefinedFields = IdlV1Field[] | IdlV1Type[];

export type IdlV1TypeDefTy =
  | { kind: "struct"; fields?: IdlV1DefinedFields }
  | {
      kind: "enum";
      variants: { name: string; fields?: IdlV1DefinedFields }[];
    }
  | { kind: "type"; alias: IdlV1Type };

export type IdlV1Type =
  | string
  | { option: IdlV1Type }
  | { coption: IdlV1Type }
  | { vec: IdlV1Type }
  | { array: [IdlV1Type, number | { generic: string }] }
  | { defined: { name: string; generics?: IdlV1GenericArg[] } }
  | { generic: string };

/**
 * What reading an IDL gave: the 0.29 shape every reader calls with, or why
 * there is none. `v029` hands back the object it was given.
 */
export type IdlReading =
  | { kind: "v029"; idl: Idl }
  | { kind: "v1"; idl: Idl; source: IdlV1 }
  | { kind: "refused"; version: "1" | undefined; reason: string };
