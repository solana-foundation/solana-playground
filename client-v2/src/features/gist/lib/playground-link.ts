/**
 * The link a share hands out: the gist opened in Playground, which
 * `routes/gist` serves as `/gist/<id>`. Built on the client, because only the
 * page knows which deployment (production, a preview) the user is sharing
 * from.
 *
 * @param origin the page's origin, `location.origin`
 * @param id the gist's id
 */
export const playgroundLink = (origin: string, id: string) =>
  `${origin.replace(/\/+$/, "")}/gist/${encodeURIComponent(id)}`;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/gist/lib/playground-link", () => {
    it("opens the gist under the page's own origin", () => {
      expect(playgroundLink("https://beta.solpg.io", "0123abcd")).toBe(
        "https://beta.solpg.io/gist/0123abcd"
      );
    });

    it("takes an origin with a trailing slash", () => {
      expect(playgroundLink("http://localhost:3000/", "ab")).toBe(
        "http://localhost:3000/gist/ab"
      );
    });
  });
}
