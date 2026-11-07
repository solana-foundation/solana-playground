import { beforeEach, expect, it, vi } from "vitest";

const common = vi.hoisted(() => ({
  disposable: { dispose: vi.fn() },
  handleRoute: vi.fn(),
}));
vi.mock("./common", () => ({ handleRoute: common.handleRoute }));
const catalog = vi.hoisted(() => ({
  catalogPage: { open: vi.fn(), close: vi.fn() },
}));
vi.mock("@/widgets/catalog", () => catalog);

import { openPageFromLink } from "./open-page-from-link";

beforeEach(() => {
  common.handleRoute.mockReset().mockReturnValue(common.disposable);
  catalog.catalogPage.open.mockReset();
});

it.each(["new-project", "tutorials", "programs"] as const)(
  "opens %s and mounts the work under it, on the page's own path",
  (page) => {
    const route = openPageFromLink(page);

    expect(catalog.catalogPage.open).toHaveBeenCalledWith(page, "link");
    // The path stays: it is the page's history entry, and a reload's
    expect(common.handleRoute).toHaveBeenCalledWith();
    expect(route).toBe(common.disposable);
  }
);
