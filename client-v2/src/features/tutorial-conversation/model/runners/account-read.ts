import { sameIdlName } from "@/shared/lib/idl-name";

import type { AccountReading, ReceiptAccount } from "../progress";

/**
 * Reading the account a lesson is about, after a run landed. The reading is
 * saved with the run, so only what a card can draw is kept: a map's tiles are
 * 40 KB of nothing it shows.
 */

/** An account's bytes and its decoded fields, as the chain has them now */
export type AccountData = Pick<AccountReading, "size" | "fields">;

const scalarOf = (value: unknown): string | undefined => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (typeof value !== "object" || !value) return undefined;
  if ("toBase58" in value && typeof value.toBase58 === "function") {
    return String(value.toBase58());
  }
  // A BN: Anchor's u64 and i64
  return "toNumber" in value ? String(value) : undefined;
};

/** A decoded account's fields that read as one value, as strings */
export const scalarsOf = (
  decoded: Record<string, unknown>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(decoded).flatMap(([field, value]) => {
      const scalar = scalarOf(value);
      return scalar === undefined ? [] : [[field, scalar]];
    })
  );

/** The reading of the account named `name` among those the run wrote to */
export const readingOf = async ({
  wrote,
  name,
  fetchAccount,
}: {
  wrote: readonly ReceiptAccount[];
  name: string;
  fetchAccount: (address: string) => Promise<AccountData | undefined>;
}): Promise<AccountReading | undefined> => {
  const account = wrote.filter((a) => sameIdlName(a.name, name)).pop();
  if (!account) return undefined;
  const data = await fetchAccount(account.address);
  return data && { name, address: account.address, ...data };
};

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("scalarsOf", () => {
    it("keeps numbers, strings, booleans and what prints as one", () => {
      const big = { toString: () => "42", toNumber: () => 42 };
      const key = { toBase58: () => "Key1" };
      expect(
        scalarsOf({ wood: big, count: 3, ok: true, name: "gm", owner: key })
      ).toEqual({
        wood: "42",
        count: "3",
        ok: "true",
        name: "gm",
        owner: "Key1",
      });
    });

    it("drops arrays and nested data: a map's tiles are 40 KB", () => {
      expect(
        scalarsOf({ tiles: [1, 2], inner: { a: 1 }, none: undefined })
      ).toEqual({});
    });
  });

  describe("readingOf", () => {
    const WROTE = [
      { name: "signer", address: "Wallet" },
      { name: "big_map", address: "Map1" },
    ];

    it("reads the account the act names, in either spelling", async () => {
      const reading = await readingOf({
        wrote: WROTE,
        name: "bigMap",
        fetchAccount: async (address) =>
          address === "Map1" ? { size: 10240, fields: { a: "1" } } : undefined,
      });
      expect(reading).toEqual({
        name: "bigMap",
        address: "Map1",
        size: 10240,
        fields: { a: "1" },
      });
    });

    it("takes the newest write of that account", async () => {
      const reading = await readingOf({
        wrote: [
          { name: "big_map", address: "Map1" },
          { name: "big_map", address: "Map2" },
        ],
        name: "bigMap",
        fetchAccount: async (address) => ({
          size: address === "Map2" ? 2 : 1,
          fields: {},
        }),
      });
      expect(reading?.address).toBe("Map2");
    });

    it("has none when the run wrote no such account, without reading", async () => {
      let asked = false;
      const reading = await readingOf({
        wrote: WROTE,
        name: "player",
        fetchAccount: async () => {
          asked = true;
          return undefined;
        },
      });
      expect(reading).toBeUndefined();
      expect(asked).toBe(false);
    });

    it("has none when the account is gone", async () => {
      const reading = await readingOf({
        wrote: WROTE,
        name: "bigMap",
        fetchAccount: async () => undefined,
      });
      expect(reading).toBeUndefined();
    });
  });
}
