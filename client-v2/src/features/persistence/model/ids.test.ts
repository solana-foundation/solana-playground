import { uuid } from "./ids";

describe("uuid", () => {
  it("returns an RFC 4122 v4 string", () => {
    expect(uuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 1000 }, uuid));
    expect(seen.size).toBe(1000);
  });

  it("works without crypto.randomUUID, which Safari 14 lacks", () => {
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
