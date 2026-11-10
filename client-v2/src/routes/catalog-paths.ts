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

/** Each page's own path, which stays in the address bar while it shows */
const PATHS: Record<LinkedPage, keyof typeof LINKS> = {
  "new-project": "/new",
  tutorials: "/tutorials",
  programs: "/programs",
};

/** The page's own path, which stays in the address bar while it shows */
export const pathOfCatalogPage = (page: LinkedPage) => PATHS[page];

/**
 * Home's own path: it has to differ from the work's path, `/` included, so
 * Back and Forward can tell them apart
 */
export const HOME_PATH = "/home";

/** Whether `path` is Home's, a trailing slash included */
export const isHomePath = (path: string) =>
  path.replace(/\/+$/, "") === HOME_PATH;

/**
 * Where Home can show: `/`, Home's own path, and the pages' links, which
 * show over Home or the work. The work cannot be drawn on these with no
 * project open.
 */
export const isStartPath = (path: string) =>
  path === "/" || isHomePath(path) || isCatalogLinkPath(path);

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
      ["/home", true],
      ["/home/", true],
      ["/tutorials", true],
      ["/programs", true],
      ["/new", true],
      ["/tutorials/hello-anchor/1", false],
      ["/open", false],
      ["/homes", false],
    ] as const)("reads %s as a start path: %s", (path, start) => {
      expect(isStartPath(path)).toBe(start);
    });

    it("gives each page its own path", () => {
      expect(pathOfCatalogPage("tutorials")).toBe("/tutorials");
      expect(pathOfCatalogPage("programs")).toBe("/programs");
      expect(pathOfCatalogPage("new-project")).toBe("/new");
      expect(isHomePath(HOME_PATH)).toBe(true);
    });

    it("leads each page's path back to the same page", () => {
      for (const page of ["new-project", "tutorials", "programs"] as const) {
        expect(catalogPageOfPath(pathOfCatalogPage(page))).toBe(page);
      }
    });
  });
}
