import {
  defaultServerEndpoint,
  FOUNDATION_ENDPOINT,
  LOCAL_ENDPOINT,
  SERVER_ENDPOINT_OPTIONS,
  SOLPG_ENDPOINT,
} from "./default-endpoint";

describe("SERVER_ENDPOINT_OPTIONS", () => {
  it("leads with the server the default points at", () => {
    expect(SERVER_ENDPOINT_OPTIONS[0]).toEqual({
      name: "Solana Foundation",
      value: FOUNDATION_ENDPOINT,
    });
  });

  it("offers api.solpg.io as a labelled choice, after Solana's", () => {
    const names = SERVER_ENDPOINT_OPTIONS.map((o) => o.name);
    const solpg = SERVER_ENDPOINT_OPTIONS.find(
      (o) => o.value === SOLPG_ENDPOINT
    );
    expect(SOLPG_ENDPOINT).toBe("https://api.solpg.io");
    expect(solpg?.name).toBe("SolPg (original backend)");
    expect(names.indexOf("Solana Foundation")).toBeLessThan(
      names.indexOf("SolPg (original backend)")
    );
  });

  it("keeps a local server selectable", () => {
    expect(LOCAL_ENDPOINT).toBe("http://localhost:8080");
    expect(
      SERVER_ENDPOINT_OPTIONS.find((o) => o.value === LOCAL_ENDPOINT)?.name
    ).toBe("Local");
  });
});

describe("defaultServerEndpoint", () => {
  it("is the Foundation's server in every environment", () => {
    for (const NODE_ENV of ["production", "development", "test"]) {
      expect(defaultServerEndpoint({ NODE_ENV })).toBe(FOUNDATION_ENDPOINT);
    }
  });

  it("never defaults to api.solpg.io (D30)", () => {
    for (const NODE_ENV of ["production", "development", "test"]) {
      expect(defaultServerEndpoint({ NODE_ENV })).not.toBe(SOLPG_ENDPOINT);
    }
  });

  it("lets REACT_APP_SERVER_URL win", () => {
    expect(
      defaultServerEndpoint({
        NODE_ENV: "development",
        REACT_APP_SERVER_URL: "http://localhost:8080",
      })
    ).toBe(LOCAL_ENDPOINT);
  });

  it("ignores an empty REACT_APP_SERVER_URL", () => {
    expect(
      defaultServerEndpoint({
        NODE_ENV: "development",
        REACT_APP_SERVER_URL: "",
      })
    ).toBe(FOUNDATION_ENDPOINT);
  });
});
