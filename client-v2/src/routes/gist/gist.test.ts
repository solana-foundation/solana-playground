// `@types/mocha` also declares a global `it`, without `each`
import { beforeEach, describe, expect, it, vi } from "vitest";

const gist = vi.hoisted(() => ({ getGistFiles: vi.fn() }));
vi.mock("@/features/gist", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/gist")>();
  return {
    parseGistRef: real.parseGistRef,
    parseGistUrl: real.parseGistUrl,
    getGistFiles: gist.getGistFiles,
  };
});

const common = vi.hoisted(() => ({ handleRoute: vi.fn() }));
vi.mock("../common", () => common);
vi.mock("../../utils", () => ({
  PgRouter: { create: <T>(route: T) => route },
}));

import { gist as gistRoute, gistDefault } from "./gist";

const FILES = [["src/lib.rs", "entrypoint!(x);"]];

/** The explorer files the route's handler hands to `handleRoute` */
const filesOpened = async () => {
  const [{ getExplorerInitArg }] = common.handleRoute.mock.calls.at(-1)!;
  return (await getExplorerInitArg()).files;
};

beforeEach(() => {
  common.handleRoute.mockReset();
  gist.getGistFiles.mockReset().mockResolvedValue({
    owner: "alice",
    files: FILES,
  });
});

describe("/gist/{ref}", () => {
  it.each([
    ["0123abcd", true],
    ["0123abcd/9f8e7d", true],
    ["not-a-gist", false],
    ["0123abcd/9f8e7d/x", false],
  ])("validate(%s) is %s", (ref, valid) => {
    expect(gistRoute.validate!({ ref })).toBe(valid);
  });

  it("opens the gist's files from a link, revision included", async () => {
    gistRoute.handle({ ref: "0123abcd/9f8e7d" });

    expect(await filesOpened()).toEqual(FILES);
    expect(gist.getGistFiles).toHaveBeenCalledWith(
      { id: "0123abcd", revision: "9f8e7d" },
      "link"
    );
  });
});

describe("/{gistUrl}", () => {
  it.each([
    ["https://gist.github.com/alice/0123abcd", true],
    ["https://github.com/alice/repo", false],
    ["tutorials", false],
  ])("validate(%s) is %s", (gistUrl, valid) => {
    expect(gistDefault.validate!({ gistUrl })).toBe(valid);
  });

  it("opens the gist the URL names", async () => {
    gistDefault.handle({ gistUrl: "https://gist.github.com/alice/0123abcd" });

    expect(await filesOpened()).toEqual(FILES);
    expect(gist.getGistFiles).toHaveBeenCalledWith(
      { owner: "alice", id: "0123abcd" },
      "link"
    );
  });
});
