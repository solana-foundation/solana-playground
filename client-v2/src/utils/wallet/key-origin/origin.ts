const LOOPBACK = "loopback";

const SWAPPED_HOST: Record<string, string> = {
  localhost: "127.0.0.1",
  "127.0.0.1": "localhost",
};

/**
 * The origin a setting names. `"loopback"` is the other loopback host of the
 * page's own, same protocol and port, for development, where `localhost` and
 * `127.0.0.1` are different origins on one machine.
 *
 * @param setting the setting's value
 * @param here where the page is
 * @returns the origin, or `null` when there is none or the setting is unusable
 */
const originFor = (setting: string | undefined, here: Location | URL) => {
  // eslint-disable-next-line unicorn/no-null -- "no origin" is the caller's switch
  if (!setting) return null;
  try {
    if (setting === LOOPBACK) {
      const host = SWAPPED_HOST[here.hostname];
      // eslint-disable-next-line unicorn/no-null -- as above
      if (!host) return null;
      const url = new URL(here.href);
      url.hostname = host;
      return url.origin;
    }
    return new URL(setting).origin;
  } catch {
    // eslint-disable-next-line unicorn/no-null -- as above
    return null;
  }
};

/**
 * @param setting the key origin setting
 * @param here where the app page is
 * @returns the origin of the key page, or `null` when keys stay in the app
 */
export const keyOriginFor = (
  setting: string | undefined,
  here: Location | URL
) => originFor(setting, here);

/**
 * @param setting the app origin setting
 * @param here where the key page is
 * @returns the origin of the app the key page serves, or `null` when unset
 */
export const appOriginFor = (
  setting: string | undefined,
  here: Location | URL
) => originFor(setting, here);

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/wallet/key-origin/origin", () => {
    it("swaps the loopback host", () => {
      expect(keyOriginFor("loopback", new URL("http://localhost:3006/x"))).toBe(
        "http://127.0.0.1:3006"
      );
      expect(keyOriginFor("loopback", new URL("http://127.0.0.1:3006/x"))).toBe(
        "http://localhost:3006"
      );
      expect(appOriginFor("loopback", new URL("https://localhost/x"))).toBe(
        "https://127.0.0.1"
      );
    });

    it("gives nothing for no setting", () => {
      const here = new URL("http://localhost:3006/");
      expect(keyOriginFor(undefined, here)).toBeNull();
      expect(keyOriginFor("", here)).toBeNull();
    });

    it("takes the origin of a URL setting", () => {
      expect(
        keyOriginFor(
          "https://wallet-keys.example.com/a",
          new URL("http://localhost:3006/")
        )
      ).toBe("https://wallet-keys.example.com");
    });

    it("gives nothing for loopback on another host or a bad URL", () => {
      expect(
        keyOriginFor("loopback", new URL("https://playground.example.com/"))
      ).toBeNull();
      expect(
        keyOriginFor("not a url", new URL("http://localhost/"))
      ).toBeNull();
    });
  });
}
