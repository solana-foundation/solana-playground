import { describe, expect, it, vi } from "vitest";

// The utils barrel reads a build-time global and cannot load under vitest;
// defining the settings needs only the real `PgCommon` and the change events
// the theme's two settings subscribe to
vi.mock("@/utils", async () => {
  const { PgCommon } = await import("@/utils/common");
  const event = () => ({ dispose: () => {} });
  return {
    PgCommon,
    PgSettings: {},
    PgBlockExplorer: { all: [] },
    DEFAULT_BLOCK_EXPLORER: "Solana Explorer",
    PgTheme: { onDidChangeFontFamily: event, onDidChangeThemeName: event },
  };
});

import { SETTINGS } from "@/settings";

import { ROWS } from "./sections";

describe("widgets/settings-page/model/sections ROWS", () => {
  // `ROWS` is keyed by plain strings, so only this ties it to the settings
  // there are: a renamed or new setting would otherwise land unlabelled at
  // the end of Advanced, and only a production report would say so
  it("has a row, or a deliberate none, for every setting there is", () => {
    const ids = SETTINGS.map((s) => s.id);
    expect(ids.filter((id) => !(id in ROWS))).toEqual([]);
  });

  it("names no setting that does not exist", () => {
    const ids = new Set<string>(SETTINGS.map((s) => s.id));
    expect(Object.keys(ROWS).filter((id) => !ids.has(id))).toEqual([]);
  });
});
