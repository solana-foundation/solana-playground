import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLogs,
  resetLogger,
} from "@/shared/lib/logger";

const utils = vi.hoisted(() => ({
  PgRouter: { navigate: vi.fn() },
  PgView: { setToast: vi.fn() },
}));
vi.mock("@/utils", () => utils);
const catalog = vi.hoisted(() => ({
  catalogPage: { open: vi.fn(), close: vi.fn() },
}));
vi.mock("@/widgets/catalog", () => catalog);

import { openPageFromLink } from "./open-page-from-link";

let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  utils.PgRouter.navigate.mockReset().mockResolvedValue(undefined);
  utils.PgView.setToast.mockReset();
  catalog.catalogPage.open.mockReset();
  catalog.catalogPage.close.mockReset();
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => resetLogger());

it("opens the page and replaces the link with the start route", async () => {
  openPageFromLink("programs");
  await Promise.resolve();

  expect(catalog.catalogPage.open).toHaveBeenCalledWith("programs", "link");
  // Replaced, not pushed: Back must not land on the link, which would push
  // `/` again and trap the user
  expect(utils.PgRouter.navigate).toHaveBeenCalledWith("/", { replace: true });
});

it("closes the page, tells the user and reports a start route it cannot reach", async () => {
  utils.PgRouter.navigate.mockRejectedValue(new Error("no router"));
  openPageFromLink("tutorials");
  await vi.waitFor(() => expect(logged.entries).toHaveLength(1));

  expect(logged.entries[0].ns).toBe("catalog:link");
  expect(logged.entries[0].report).toBe(true);
  expect(catalog.catalogPage.close).toHaveBeenCalledTimes(1);
  expect(utils.PgView.setToast).toHaveBeenCalledTimes(1);
});
