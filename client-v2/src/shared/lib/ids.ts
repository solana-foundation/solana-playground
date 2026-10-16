import { v4, validate } from "uuid";

/**
 * A v4 UUID, minted on the client so a repeated append collapses on the
 * primary key. Not `crypto.randomUUID`: it exists only in secure contexts, so
 * a plain-http LAN origin lacks it, while the library needs only
 * `getRandomValues`.
 */
export const uuid = (): string => v4();

/** A string `isUuid` accepted. Branded so the guard's false branch stays `string`. */
export type Uuid = string & { readonly __uuid: true };

/** Whether `value` is a UUID of version 1 to 5, or the nil UUID (what `uuid@8`'s `validate` accepts; not v6-v8). */
export const isUuid = (value: unknown): value is Uuid =>
  typeof value === "string" && validate(value);

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("uuid", () => {
    it("passes isUuid, which is how callers check the shape", () => {
      expect(isUuid(uuid())).toBe(true);
    });

    it("does not repeat", () => {
      const seen = new Set(Array.from({ length: 1000 }, uuid));
      expect(seen.size).toBe(1000);
    });

    it("mints a v4 without crypto.randomUUID, which insecure origins lack", () => {
      const original = crypto.randomUUID;
      // @ts-expect-error -- deleting an optional platform method for the fallback
      delete crypto.randomUUID;
      try {
        expect(uuid()).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );
      } finally {
        crypto.randomUUID = original;
      }
    });
  });

  describe("isUuid", () => {
    it("rejects a string of the right shape with one non-hex character", () => {
      expect(isUuid("0f8fad5b-d9cb-469f-a165-70867728950g")).toBe(false);
    });

    it("rejects what is not a string", () => {
      expect(isUuid(undefined)).toBe(false);
      expect(isUuid(42)).toBe(false);
    });

    it("accepts versions 1 to 5 and nil, not 7", () => {
      expect(isUuid("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true);
      expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
      expect(isUuid("017f22e2-79b0-7cc3-98c4-dc0c0c07398f")).toBe(false);
    });

    it("keeps a string that fails the guard a string", () => {
      const id: string = "not-an-id";
      if (!isUuid(id)) expect(id.trim()).toBe("not-an-id");
    });
  });
}
