/** The links that open a page: the bare `/new`, `/tutorials` and `/programs` */
const LINKS = {
  "/new": "new-project",
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

/** Whether `path` is one of the links that open a page */
export const isCatalogLinkPath = (path: string) =>
  catalogPageOfPath(path) !== null;

/** The page's own path, which stays in the address bar while it shows */
export const pathOfCatalogPage = (page: LinkedPage): keyof typeof LINKS =>
  PATHS[page];

/** `LINKS` read the other way; the tests below keep the two in step */
const PATHS: Record<LinkedPage, keyof typeof LINKS> = {
  "new-project": "/new",
  tutorials: "/tutorials",
  programs: "/programs",
};

/**
 * Where Home can show: `/` and the pages' links, which show over Home or the
 * work. The work cannot be drawn on these with no project open.
 */
export const isStartPath = (path: string) =>
  path === "/" || isCatalogLinkPath(path);

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("routes/catalog-paths", () => {
    it.each([
      ["/tutorials", "tutorials"],
      ["/tutorials/", "tutorials"],
      ["/programs", "programs"],
      ["/new", "new-project"],
      ["/new/", "new-project"],
      ["/tutorials/hello-anchor", null],
      ["/", null],
      ["/programs/x", null],
    ] as const)("reads %s as the page %s", (path, page) => {
      expect(catalogPageOfPath(path)).toBe(page);
      expect(isCatalogLinkPath(path)).toBe(page !== null);
    });

    it.each([
      ["/", true],
      ["/tutorials", true],
      ["/programs/", true],
      ["/new", true],
      ["/tutorials/hello-anchor/1", false],
      ["/open", false],
      ["/news", false],
    ] as const)("reads %s as a start path: %s", (path, start) => {
      expect(isStartPath(path)).toBe(start);
    });

    it.each(["new-project", "tutorials", "programs"] as const)(
      "leads the page %s's own path back to the same page",
      (page) => {
        expect(catalogPageOfPath(pathOfCatalogPage(page))).toBe(page);
      }
    );

    it("gives New project the path /new", () => {
      expect(pathOfCatalogPage("new-project")).toBe("/new");
    });
  });
}
