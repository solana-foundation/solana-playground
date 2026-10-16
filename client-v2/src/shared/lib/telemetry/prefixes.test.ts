import { EVENT_PREFIXES } from "./prefixes";

it("should give each slice its own prefix", () => {
  const sliceOf = new Map<string, string>();
  const clashes: string[] = [];

  for (const [slice, prefix] of Object.entries(EVENT_PREFIXES)) {
    const owner = sliceOf.get(prefix);
    if (owner) clashes.push(`${owner} and ${slice} share "${prefix}"`);
    sliceOf.set(prefix, slice);
  }

  expect(clashes).toEqual([]);
});
