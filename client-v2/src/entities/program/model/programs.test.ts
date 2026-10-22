import { beforeEach, expect, it, vi } from "vitest";

const utils = vi.hoisted(() => ({ PgCommon: { fetchJSON: vi.fn() } }));
vi.mock("@/utils", () => utils);

import { fetchPrograms, PROGRAMS_URL } from "./programs";

const program = {
  name: "drift-v2",
  description: "Perpetuals",
  repo: "https://github.com/drift-labs/protocol-v2",
  icon: "/drift.png",
  framework: "Anchor",
  categories: ["DeFi"],
};

beforeEach(() => utils.PgCommon.fetchJSON.mockReset());

it("reads the listing", async () => {
  utils.PgCommon.fetchJSON.mockResolvedValue([program]);

  expect(await fetchPrograms()).toEqual([program]);
  expect(utils.PgCommon.fetchJSON).toHaveBeenCalledWith(PROGRAMS_URL);
});

it("refuses a body that is not a list", async () => {
  utils.PgCommon.fetchJSON.mockResolvedValue({ error: "upstream" });

  await expect(fetchPrograms()).rejects.toThrow(/not a list of programs/);
});

it("refuses an entry missing a field the pages read", async () => {
  const noCategories = {
    name: program.name,
    description: program.description,
    repo: program.repo,
    icon: program.icon,
    framework: program.framework,
  };
  utils.PgCommon.fetchJSON.mockResolvedValue([program, noCategories]);

  await expect(fetchPrograms()).rejects.toThrow(/entry 1/);
});
