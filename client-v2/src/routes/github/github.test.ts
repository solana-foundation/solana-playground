// `@types/mocha` also declares a global `it`, without `each`
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { GithubImportError } from "@/utils/import-error";

const common = vi.hoisted(() => ({ handleRoute: vi.fn() }));
vi.mock("../common", () => common);
const utils = vi.hoisted(() => ({ getFiles: vi.fn() }));
vi.mock("../../utils", () => ({
  GITHUB_ROUTE: "/github",
  PgGithub: { getFiles: utils.getFiles, isValidUrl: () => true },
  PgRouter: { create: <T>(route: T) => route },
}));

import { github } from "./github";

const FILES = [["src/lib.rs", "entrypoint!(x);"]];

/** The explorer init argument the route's handler hands to `handleRoute` */
const opened = async () => {
  const [{ getExplorerInitArg }] = common.handleRoute.mock.calls.at(-1) ?? [];
  return getExplorerInitArg();
};

let sent: ReturnType<typeof memoryProvider>;

beforeEach(() => {
  common.handleRoute.mockReset();
  utils.getFiles.mockReset();
  resetTelemetry();
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});

describe("/github/{path}", () => {
  it("opens the repository's files and counts the view", async () => {
    utils.getFiles.mockResolvedValue(FILES);
    github.handle({ path: "coral-xyz/xnft" });

    expect(await opened()).toEqual({ files: FILES });
    expect(utils.getFiles).toHaveBeenCalledWith("github.com/coral-xyz/xnft");
    expect(sent.events).toEqual([
      expect.objectContaining({ name: "project_viewed", params: {} }),
    ]);
  });

  it("counts a link that does not load and still fails the route", async () => {
    const missing = new GithubImportError("missing", "not-found");
    utils.getFiles.mockRejectedValue(missing);
    github.handle({ path: "coral-xyz/gone" });

    await expect(opened()).rejects.toBe(missing);
    expect(sent.events).toEqual([
      expect.objectContaining({
        name: "project_view_failed",
        params: { reason: "not-found" },
      }),
    ]);
  });
});
