import { experimental } from "./experimental";

vi.mock("../../utils", () => ({
  PgCommon: {
    toTitleFromCamel: (s: string) => s,
    toKebabFromTitle: (s: string) => s,
    capitalize: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
    getValue: vi.fn(),
    setValue: vi.fn(),
  },
  PgSettings: {},
}));

// Upstream defaults this to `NODE_ENV !== "production"`. This fork builds
// against hosted servers that have no `unstable` routes, so the default is
// off everywhere and turning it on is the deliberate act (D37).
describe("experimental.unstable", () => {
  const setting = experimental.find((s) => s.id === "experimental.unstable");

  it("exists as a checkbox setting", () => {
    expect(setting).toBeDefined();
    expect(setting?.values).toBeUndefined();
  });

  it("defaults to off, as a literal rather than a NODE_ENV rule", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(setting?.default).toBe(false);
  });
});
