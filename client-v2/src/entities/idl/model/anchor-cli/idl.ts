import { isAddress } from "@solana/kit";

import { isRecord, valueOrThrow } from "./decode";
import { heckLowerCamelCase, heckPascalCase } from "./heck";
import { decodeLegacyIdl, idlFromLegacy, legacyFromIdl } from "./legacy";
import { type AnchorIdl, decodeIdl, IDL_SPEC } from "./spec";

/** `serde_json`'s pretty printer */
const pretty = (value: unknown) => JSON.stringify(value, undefined, 2);

/** Anchor's `apply_program_id_override`: the current spec holds the address at the top, the legacy one under `metadata` */
const withProgramId = (programId: string, json: unknown) => {
  if (!isAddress(programId)) {
    throw new Error(`Invalid program id: ${programId}`);
  }
  if (!isRecord(json)) throw new Error("IDL must be an object");
  const { metadata } = json;
  if (!isRecord(metadata)) {
    return { ...json, metadata: { address: programId } };
  }
  return Object.hasOwn(metadata, "spec")
    ? { ...json, address: programId }
    : { ...json, metadata: { ...metadata, address: programId } };
};

/** Anchor's `convert_idl`: a `metadata.spec` that is a string marks the current spec, anything else the legacy one */
const idlOf = async (json: unknown): Promise<AnchorIdl> => {
  const spec =
    isRecord(json) && isRecord(json.metadata) ? json.metadata.spec : undefined;
  if (typeof spec !== "string") {
    return idlFromLegacy(valueOrThrow(decodeLegacyIdl(json)));
  }
  if (spec !== IDL_SPEC) throw new Error(`IDL spec not supported: \`${spec}\``);
  return valueOrThrow(decodeIdl(json));
};

/** The IDL in a file's text, in the current format; `programId` is the value of `--program-id` */
const parseIdl = async (programId: string | undefined, text: string) => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new Error("The IDL is not valid JSON", { cause });
  }
  return idlOf(programId === undefined ? json : withProgramId(programId, json));
};

/**
 * What `anchor idl convert <PATH>` of Anchor 1.1.2 prints for a file that
 * holds `text`: the IDL in the current format. `programId` is the value of
 * `--program-id`. Throws an `Error` for a file Anchor rejects.
 */
export const convertIdl = async (
  programId: string | undefined,
  text: string
): Promise<string> => `${pretty(await parseIdl(programId, text))}\n`;

/**
 * What `anchor idl convert <PATH> --to-legacy` of Anchor 1.1.2 prints: the IDL
 * in the format before Anchor 0.30. Unlike `toLegacyIdl`, which shapes an IDL
 * for the 0.29 client, the result is text and follows Anchor's converter.
 */
export const convertIdlToLegacy = async (
  programId: string | undefined,
  text: string
): Promise<string> =>
  `${pretty(legacyFromIdl(await parseIdl(programId, text)))}\n`;

const IDENTIFIER_KEYS = new Set([
  "name",
  "path",
  "account",
  "relations",
  "generic",
]);

/** Anchor's `camel_case_idl_identifier`: an address keeps its case, and a dotted path is cased part by part */
const camelCaseIdentifier = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(camelCaseIdentifier);
  if (typeof value !== "string") return camelCaseIdentifiers(value);
  return isAddress(value)
    ? value
    : value.split(".").map(heckLowerCamelCase).join(".");
};

/** Anchor's `camel_case_idl_identifiers` */
const camelCaseIdentifiers = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(camelCaseIdentifiers);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      IDENTIFIER_KEYS.has(key)
        ? camelCaseIdentifier(inner)
        : camelCaseIdentifiers(inner),
    ])
  );
};

/**
 * What `anchor idl type <PATH>` of Anchor 1.1.2 prints for a file that holds
 * `text`: the TypeScript type of the IDL. Throws an `Error` for a file Anchor
 * rejects.
 */
export const idlTypeScript = async (text: string): Promise<string> => {
  const idl = await parseIdl(undefined, text);
  const { name } = idl.metadata;
  return `/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at \`target/idl/${name}.json\`.
 */
export type ${heckPascalCase(name)} = ${pretty(camelCaseIdentifiers(idl))};

`;
};

if (import.meta.vitest) {
  const { beforeAll, describe, expect, it } = import.meta.vitest;

  describe("entities/idl/model/anchor-cli/idl", () => {
    let readFileSync: typeof import("node:fs").readFileSync;
    let join: typeof import("node:path").join;

    beforeAll(async () => {
      ({ readFileSync } = await import("node:fs"));
      ({ join } = await import("node:path"));
    });

    /** A file of `__fixtures__`: an input, or what the Anchor 1.1.2 binary printed for one, which `regenerate.sh` writes */
    const fixture = (name: string) =>
      readFileSync(join(__dirname, "__fixtures__", name), "utf8");

    /** One input of `rejected.json`, as the text of a file */
    const rejected = (group: string, name: string) =>
      JSON.stringify(JSON.parse(fixture("rejected.json"))[group][name]);

    const PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const convert = (text: string) => convertIdl(undefined, text);
    const convertWithProgramId = (text: string) => convertIdl(PROGRAM_ID, text);
    const convertToLegacy = (text: string) =>
      convertIdlToLegacy(undefined, text);

    it.each([
      { expected: "legacy.convert.txt", print: convert, input: "legacy.json" },
      {
        expected: "legacy.convert-program-id.txt",
        print: convertWithProgramId,
        input: "legacy.json",
      },
      {
        expected: "legacy-no-address.convert-program-id.txt",
        print: convertWithProgramId,
        input: "legacy-no-address.json",
      },
      {
        expected: "current-full.convert-program-id.txt",
        print: convertWithProgramId,
        input: "current-full.json",
      },
      {
        expected: "current.convert-to-legacy.txt",
        print: convertToLegacy,
        input: "current.json",
      },
      {
        expected: "current-full.type.txt",
        print: idlTypeScript,
        input: "current-full.json",
      },
    ])(
      "prints $expected as the Anchor 1.1.2 binary did",
      async ({ expected, print, input }) => {
        expect(await print(fixture(input))).toBe(fixture(expected));
      }
    );

    // The Anchor 1.1.2 binary exits with status 1 for this file
    it("rejects a legacy IDL that holds no address when no program id is given", async () => {
      await expect(convert(fixture("legacy-no-address.json"))).rejects.toThrow(
        "Program id missing"
      );
    });

    // The Anchor 1.1.2 binary exits with status 2 for this program id
    it("rejects a program id that is not an address", async () => {
      await expect(
        convertIdl("not-an-address", fixture("legacy.json"))
      ).rejects.toThrow("Invalid program id");
    });

    // The Anchor 1.1.2 binary exits with status 1 for each input
    it.each([
      ["unsupported-spec", "IDL spec not supported: `0.2.0`"],
      ["missing-discriminator", "instructions[0].discriminator is missing"],
      ["const-seed-type", "Const seed conversion not supported"],
    ])("rejects the %s input", async (name, message) => {
      await expect(convert(rejected("convert", name))).rejects.toThrow(message);
    });

    // The Anchor 1.1.2 binary exits with status 1 for each input under `--to-legacy`
    it.each([
      ["tuple-struct", "Tuple-style struct fields"],
      ["const-generic", "uses const generics"],
      ["non-borsh", "uses non-Borsh serialization"],
      ["event-tuple-struct", "is a tuple struct"],
      ["event-enum", "must be defined as a struct"],
      ["account-without-type", "not defined in `types`"],
    ])("refuses the legacy format for the %s input", async (name, message) => {
      await expect(
        convertToLegacy(rejected("convertToLegacy", name))
      ).rejects.toThrow(message);
    });
  });
}
