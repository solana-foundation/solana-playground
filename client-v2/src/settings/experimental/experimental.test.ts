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

const UNSTABLE_ID = "experimental.unstable";

// `client-env` reads the variable at import, so each case loads the modules afresh
const importDefaultWith = async (value: string | undefined) => {
  vi.stubEnv("REACT_APP_SERVER_UNSTABLE", value);
  vi.resetModules();
  const fresh = await import("./experimental");
  return fresh.experimental.find((s) => s.id === UNSTABLE_ID)?.default;
};

describe("experimental.unstable", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exists as a checkbox setting", () => {
    const setting = experimental.find((s) => s.id === UNSTABLE_ID);
    expect(setting).toBeDefined();
    expect(setting?.values).toBeUndefined();
  });

  it.each([
    { value: "true", expected: true },
    { value: undefined, expected: false },
    { value: "1", expected: false },
  ])(
    "defaults to $expected when REACT_APP_SERVER_UNSTABLE is $value",
    async ({ value, expected }) => {
      expect(await importDefaultWith(value)).toBe(expected);
    }
  );
});
