import { beforeEach, expect, it, vi } from "vitest";

const common = vi.hoisted(() => ({
  route: { dispose: vi.fn() },
  handleRoute: vi.fn(),
}));
vi.mock("./common", () => ({ handleRoute: common.handleRoute }));
const catalog = vi.hoisted(() => ({
  catalogPage: { open: vi.fn(), close: vi.fn() },
}));
vi.mock("@/widgets/catalog", () => catalog);

import { openPageFromLink } from "./open-page-from-link";

beforeEach(() => {
  common.handleRoute.mockReset().mockReturnValue(common.route);
  catalog.catalogPage.open.mockReset();
});

it("opens the page and mounts the work under it, keeping the link's path", () => {
  const route = openPageFromLink("programs");

  expect(catalog.catalogPage.open).toHaveBeenCalledWith("programs", "link");
  // The work's route, disposed with the page's when the path moves on
  expect(common.handleRoute).toHaveBeenCalledWith();
  expect(route).toBe(common.route);
});

it("opens New project from `/new` the same way", () => {
  const route = openPageFromLink("new-project");

  expect(catalog.catalogPage.open).toHaveBeenCalledWith("new-project", "link");
  expect(common.handleRoute).toHaveBeenCalledWith();
  expect(route).toBe(common.route);
});
