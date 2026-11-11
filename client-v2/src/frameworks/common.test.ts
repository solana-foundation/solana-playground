// The exported `Cargo.toml` dependencies; mocks the utils barrel the export
// reads the crate versions and features through.
import { describe, expect, it, vi } from "vitest";

const SERVED: Record<string, unknown> = {
  "/crates/versions.json": { "anchor-lang": "1.1.2", arrayref: "0.3.9" },
  "/crates/features.json": { "anchor-lang": ["event-cpi", "init-if-needed"] },
};

vi.mock("../utils", () => ({
  PgCommon: {
    fetchJSON: async (path: string) => SERVED[path],
    fetchText: async (path: string) => JSON.stringify(SERVED[path]),
    toKebabFromSnake: (name: string) => name.replaceAll("_", "-"),
  },
}));
vi.mock("./SelectProgram", () => ({ SelectProgram: () => undefined }));
vi.stubGlobal("CRATES", {
  importable: ["anchor_lang", "arrayref", "unknown_crate"],
});

const { getRustDependencies } = await import("./common");

describe("frameworks/common", () => {
  it("pins the crate versions and features the server builds with", async () => {
    const files: [string, string][] = [
      [
        "src/lib.rs",
        "use anchor_lang::prelude::*;\nuse arrayref::array_ref;\nuse unknown_crate::x;",
      ],
    ];

    expect(await getRustDependencies(files)).toBe(
      [
        "[dependencies]",
        'anchor-lang = { version = "=1.1.2", features = ["event-cpi", "init-if-needed"] }',
        'arrayref = "=0.3.9"',
        'unknown-crate = "*"',
      ].join("\n")
    );
  });

  it("names the features file when it is not a map of feature lists", async () => {
    const served = SERVED["/crates/features.json"];
    SERVED["/crates/features.json"] = { "anchor-lang": "event-cpi" };
    try {
      await expect(
        getRustDependencies([["src/lib.rs", "use anchor_lang::x;"]])
      ).rejects.toThrow("/crates/features.json");
    } finally {
      SERVED["/crates/features.json"] = served;
    }
  });
});
