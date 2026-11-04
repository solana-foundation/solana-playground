// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, so its tests stay out of the modules (AGENTS.md).
//
// Spec 13, "Offline": every command that needs the server or a cluster ends
// at once offline, and the local ones keep working. A new command lands in
// one list or the other here, so the choice is made, not defaulted.
import { describe, expect, it, vi } from "vitest";

import { COMMANDS } from "./index";

// `settings.ts`, reached through the commands' imports, reads a global that
// only exists once the app has booted
vi.hoisted(() => {
  vi.stubGlobal("GLOBAL_SETTINGS", { default: {} });
});

// The wasm packages are built separately and absent from a plain checkout
vi.mock("../utils/package", () => ({ PgPackage: {} }));

const NEEDS_CONNECTION = [
  "airdrop",
  "anchor",
  "build",
  "deploy",
  "run",
  "solana",
  "spl-token",
  "sugar",
  "test",
];

const LOCAL = ["clear", "connect", "help", "prettier", "rustfmt", "setting"];

describe("commands that need a connection", () => {
  const byName = Object.fromEntries(
    Object.values(COMMANDS).map((cmd) => [
      cmd.name,
      "needsConnection" in cmd && cmd.needsConnection === true,
    ])
  );

  it("names every command in one list", () => {
    expect(Object.keys(byName).sort()).toEqual(
      NEEDS_CONNECTION.concat(LOCAL).sort()
    );
  });

  it.each(NEEDS_CONNECTION)("%s needs a connection", (name) => {
    expect(byName[name]).toBe(true);
  });

  it.each(LOCAL)("%s runs offline", (name) => {
    expect(byName[name]).toBe(false);
  });
});
