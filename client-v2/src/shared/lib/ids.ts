import { v4, validate, version } from "uuid";

/**
 * A v4 UUID, minted on the client so a repeated append collapses on the
 * primary key. Not `crypto.randomUUID`: it exists only in secure contexts, so
 * a plain-http LAN origin lacks it, while the library needs only
 * `getRandomValues`.
 */
export const uuid = (): string => v4();

/** A string `isUuid` accepted. Branded so the guard's false branch stays `string`. */
export type Uuid = string & { readonly __uuid: true };

/** Whether `value` is a UUID of version 1 to 5, or the nil UUID; `validate` alone also accepts v6-v8 and the max UUID. */
export const isUuid = (value: unknown): value is Uuid =>
  typeof value === "string" && validate(value) && version(value) <= 5;
