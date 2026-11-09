// The exported `Cargo.toml` dependencies; mocks the utils barrel the export
// reads the crate versions through.
import { describe, expect, it, vi } from "vitest";

vi.mock("../utils", () => ({
  PgCommon: {
    fetchJSON: async () => ({ "anchor-lang": "1.1.2" }),
    toKebabFromSnake: (name: string) => name.replaceAll("_", "-"),
  },
}));
vi.mock("./SelectProgram", () => ({ SelectProgram: () => undefined }));
vi.stubGlobal("CRATES", { importable: ["anchor_lang", "unknown_crate"] });

const { getRustDependencies } = await import("./common");

describe("frameworks/common", () => {
  it("pins the crate versions the server builds with", async () => {
    const files: [string, string][] = [
      ["src/lib.rs", "use anchor_lang::prelude::*;\nuse unknown_crate::x;"],
    ];

    expect(await getRustDependencies(files)).toBe(
      '[dependencies]\nanchor-lang = "=1.1.2"\nunknown-crate = "*"'
    );
  });
});
