import { afterEach, describe, expect, it, vi } from "vitest";
import { FitAddon } from "xterm-addon-fit";

import { PgTerm } from "./terminal";
import type { CommandManager } from "./types";

/** No commands: fitting reads none */
const COMMANDS: CommandManager = {
  getNames: () => [],
  getCompletions: () => ({}),
  execute: async () => undefined,
  stop: () => undefined,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PgTerm.fit", () => {
  it("keeps its size while the console is collapsed", () => {
    vi.spyOn(FitAddon.prototype, "proposeDimensions").mockReturnValue({
      cols: 80,
      rows: 1,
    });
    const fit = vi.spyOn(FitAddon.prototype, "fit");

    new PgTerm(COMMANDS).fit();

    expect(fit).not.toHaveBeenCalled();
  });

  it("fits once there is room for two rows", () => {
    vi.spyOn(FitAddon.prototype, "proposeDimensions").mockReturnValue({
      cols: 80,
      rows: 2,
    });
    const fit = vi
      .spyOn(FitAddon.prototype, "fit")
      .mockImplementation(() => {});

    new PgTerm(COMMANDS).fit();

    expect(fit).toHaveBeenCalledOnce();
  });
});
