/** The links that open a page: the bare `/tutorials` and `/programs` */
const LINKS = {
  "/tutorials": "tutorials",
  "/programs": "programs",
} as const;

type LinkedPage = typeof LINKS[keyof typeof LINKS];

/**
 * The page a link opens, or null for any other path, a tutorial's own
 * (`/tutorials/<name>`) included. A trailing slash is the same link.
 */
export const catalogPageOfPath = (path: string): LinkedPage | null => {
  const bare = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return bare in LINKS ? LINKS[bare as keyof typeof LINKS] : null;
};

/** A tutorial's own route, `/tutorials/<name>[/<page>]`, which opens it in the work */
export const isTutorialRoutePath = (path: string) =>
  /^\/tutorials\/[^/]+/.test(path);

/** Whether `path` is one of the links that open a page */
export const isCatalogLinkPath = (path: string) =>
  catalogPageOfPath(path) !== null;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("routes/catalog-paths", () => {
    it.each([
      ["/tutorials", "tutorials"],
      ["/tutorials/", "tutorials"],
      ["/programs", "programs"],
      ["/tutorials/hello-anchor", null],
      ["/", null],
      ["/programs/x", null],
    ] as const)("reads %s as the page %s", (path, page) => {
      expect(catalogPageOfPath(path)).toBe(page);
      expect(isCatalogLinkPath(path)).toBe(page !== null);
    });

    it.each([
      ["/tutorials/hello-anchor", true],
      ["/tutorials/hello-anchor/2", true],
      ["/tutorials", false],
      ["/tutorials/", false],
      ["/", false],
    ] as const)("reads %s as a tutorial's route: %s", (path, route) => {
      expect(isTutorialRoutePath(path)).toBe(route);
    });
  });
}
