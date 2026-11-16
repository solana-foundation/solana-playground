/**
 * Whether an address, as a page would resolve it, points at this app's own
 * origin. The browser's URL parser decides, so the forms a prefix check
 * misses count as remote: `//host` (no scheme), `/\host`, `\\host`, an
 * address with a tab inside, and one with leading spaces. An address that
 * does not parse, or that has no origin of its own (`data:`), is not
 * same-origin, and with no `location` (outside a page) nothing is.
 */
export const isSameOrigin = (address: string): boolean => {
  const here = globalThis.location?.href;
  if (here === undefined) return false;

  try {
    return new URL(address, here).origin === new URL(here).origin;
  } catch {
    // An address the URL parser rejects loads nothing, so it is no local one
    return false;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/same-origin", () => {
    it("takes a local path, a relative path and this origin as same-origin", () => {
      expect(isSameOrigin("/tutorials/hello/image.png")).toBe(true);
      expect(isSameOrigin("image.png")).toBe(true);
      expect(isSameOrigin("./assets/image.png")).toBe(true);
      expect(isSameOrigin(`${globalThis.location.origin}/image.png`)).toBe(
        true
      );
    });

    it("takes an address with another host as remote, with a scheme or without", () => {
      expect(isSameOrigin("https://example.com/image.png")).toBe(false);
      // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- the address under test, never fetched
      expect(isSameOrigin("http://example.com/image.png")).toBe(false);
      expect(isSameOrigin("//example.com/image.png")).toBe(false);
    });

    it("takes the forms the URL parser reads as another host as remote", () => {
      expect(isSameOrigin("/\\example.com/image.png")).toBe(false);
      expect(isSameOrigin("\\\\example.com/image.png")).toBe(false);
      expect(isSameOrigin("/\t/example.com/image.png")).toBe(false);
      expect(isSameOrigin(" //example.com/image.png")).toBe(false);
    });

    it("takes an address with no origin of its own as remote", () => {
      expect(isSameOrigin("data:image/png;base64,AAAA")).toBe(false);
    });

    it("takes an address the URL parser rejects as remote", () => {
      expect(isSameOrigin("https://[example.com/image.png")).toBe(false);
    });
  });
}
