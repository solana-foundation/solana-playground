import type { Idl } from "@coral-xyz/anchor";

import { createLogger } from "@/shared/lib/logger";

import { IdlRefusal, toLegacyIdl } from "./to-legacy";
import type { IdlReading, IdlV1 } from "./types";

const log = createLogger("idl:reader");

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isV1 = (
  v: Record<string, unknown>
): v is Record<string, unknown> & IdlV1 =>
  isObject(v.metadata) &&
  typeof v.metadata.spec === "string" &&
  Array.isArray(v.instructions);

/** An IDL in the Anchor 0.30+ format, whether or not {@link readIdl} can map it to the 0.29 shape */
export const isIdlV1 = (raw: unknown): raw is IdlV1 =>
  isObject(raw) && isV1(raw);

const isV029 = (v: Record<string, unknown>) =>
  typeof v.name === "string" &&
  typeof v.version === "string" &&
  Array.isArray(v.instructions);

const NOT_AN_IDL: IdlReading = {
  kind: "refused",
  version: undefined,
  reason: "not an Anchor IDL",
};

/**
 * One reading per IDL object, so every render gets the same conversion. Holds
 * because `PgProgramInfo.update` replaces the IDL, never edits it in place.
 */
const memo = new WeakMap<object, IdlReading>();

/**
 * Reads an Anchor IDL of either version into the 0.29 shape the client calls
 * with. Never throws: what cannot be called is a `refused` reading.
 */
export const readIdl = (raw: unknown): IdlReading => {
  if (!isObject(raw)) return NOT_AN_IDL;
  const known = memo.get(raw);
  if (known) return known;
  const reading = read(raw);
  memo.set(raw, reading);
  if (reading.kind === "refused" && reading.version) {
    log.warn("Refused an Anchor IDL", {
      context: {
        reason: reading.reason,
        program: programName(raw),
        spec: isObject(raw.metadata) ? raw.metadata.spec : undefined,
      },
    });
  }
  return reading;
};

/**
 * The program an IDL is for: a 1.x IDL names it under `metadata`; a legacy
 * one at the top, even when a deploy added `metadata.address`
 */
export const programName = (raw: object): string | undefined => {
  const { name, metadata } = raw as { name?: unknown; metadata?: unknown };
  return [isObject(metadata) ? metadata.name : undefined, name].find(
    (n): n is string => typeof n === "string" && n !== ""
  );
};

const read = (raw: Record<string, unknown>): IdlReading => {
  if (isV1(raw)) {
    try {
      return { kind: "v1", idl: toLegacyIdl(raw), source: raw };
    } catch (e) {
      if (e instanceof IdlRefusal) {
        return { kind: "refused", version: "1", reason: e.message };
      }
      // A shape the mapping does not know: refused, and reported so the
      // mapping learns it
      log.error(e, {
        report: true,
        context: { program: programName(raw) },
      });
      return {
        kind: "refused",
        version: "1",
        reason: "a shape this version of the Playground does not know",
      };
    }
  }
  if (isV029(raw)) return { kind: "v029", idl: raw as unknown as Idl };
  return NOT_AN_IDL;
};
