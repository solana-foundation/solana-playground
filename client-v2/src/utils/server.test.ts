import { PgServer, PgServerError } from "./server";

const settings = {
  server: { endpoint: "http://server.test" },
  experimental: { unstable: false },
};

vi.mock("./settings", () => ({
  get PgSettings() {
    return settings;
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const respond = (body: unknown) => {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => String(body),
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });
};

const requestedUrl = () => mockFetch.mock.calls[0][0] as string;
const requestInit = () => mockFetch.mock.calls[0][1] as RequestInit;

beforeEach(() => {
  mockFetch.mockReset();
  settings.experimental.unstable = false;
});

describe("PgServer routes", () => {
  it("posts a build to /build on the chosen server", async () => {
    respond({ stderr: "", uuid: "u", idl: null });
    await PgServer.build({ files: [] });

    expect(requestedUrl()).toBe("http://server.test/build");
    expect(requestInit().method).toBe("POST");
  });

  it("gets the program from /deploy/:uuid", async () => {
    respond(null);
    const bytes = await PgServer.deploy("abc");

    expect(requestedUrl()).toBe("http://server.test/deploy/abc");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it("sends the route the project a build belongs to", async () => {
    settings.server.endpoint = "/api/build-server";
    try {
      respond({ stderr: "", uuid: "u" });
      await PgServer.build({
        files: [],
        project: { id: "p1", name: "hello" },
      });

      expect(JSON.parse(requestInit().body as string).project).toEqual({
        id: "p1",
        name: "hello",
      });
    } finally {
      settings.server.endpoint = "http://server.test";
    }
  });

  it("keeps the project from a server other than the route", async () => {
    respond({ stderr: "", uuid: "u" });
    await PgServer.build({ files: [], project: { id: "p1", name: "hello" } });

    expect(JSON.parse(requestInit().body as string)).not.toHaveProperty(
      "project"
    );
  });

  it("sends shares to the share server while builds go through the route", async () => {
    settings.server.endpoint = "/api/build-server";
    try {
      respond("share-id");
      await PgServer.shareNew({ explorer: { files: {} } });
      expect(requestedUrl()).toBe("https://api.solpg.io/new");
    } finally {
      settings.server.endpoint = "http://server.test";
    }
  });

  it("reaches a route on this origin given as a path", async () => {
    settings.server.endpoint = "/api/build-server";
    try {
      respond({ stderr: "", uuid: "u" });
      await PgServer.build({ files: [] });
      expect(requestedUrl()).toBe("/api/build-server/build");
    } finally {
      settings.server.endpoint = "http://server.test";
    }
  });

  // The server in this tree has no such routes; a client that still asked
  // for them would be a scheduled break against any server built from it
  it("has no packages or types routes any more", () => {
    const server = PgServer as unknown as Record<string, unknown>;
    expect(server.packages).toBeUndefined();
    expect(server.types).toBeUndefined();
  });
});

describe("the unstable switch", () => {
  beforeEach(() => {
    settings.experimental.unstable = true;
  });

  it("prefixes build with /unstable", async () => {
    respond({ stderr: "", uuid: null, idl: null });
    await PgServer.build({ files: [] });
    expect(requestedUrl()).toBe("http://server.test/unstable/build");
  });

  it("prefixes deploy with /unstable", async () => {
    respond(null);
    await PgServer.deploy("abc");
    expect(requestedUrl()).toBe("http://server.test/unstable/deploy/abc");
  });

  it("leaves the share routes alone: they have no sandbox to pick", async () => {
    respond("share-id");
    await PgServer.shareNew({ explorer: { files: {} } });
    expect(requestedUrl()).toBe("http://server.test/new");
  });
});

describe("PgServer failures", () => {
  it("keeps the status and body of a refused request", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Program is not built",
    });

    const error = await PgServer.deploy("gone").catch((e) => e);

    expect(error).toBeInstanceOf(PgServerError);
    expect(error.status).toBe(500);
    expect(error.body).toBe("Program is not built");
    expect(error.message).toBe(
      "Server request failed (http://server.test/deploy/gone): Program is not built"
    );
  });

  it("has no status when the request never got an answer", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const error = await PgServer.deploy("x").catch((e) => e);

    expect(error).toBeInstanceOf(PgServerError);
    expect(error.status).toBeUndefined();
  });
});

describe("PgServer refusals with an unreadable body", () => {
  it("still reports the status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.reject(new TypeError("body stream reset")),
    });

    const error = await PgServer.deploy("x").catch((e) => e);

    expect(error).toBeInstanceOf(PgServerError);
    expect(error.status).toBe(502);
    expect(error.body).toBe("<unreadable response body>");
  });

  it("keeps the network error as the cause", async () => {
    const offline = new TypeError("Failed to fetch");
    mockFetch.mockRejectedValue(offline);

    const error = await PgServer.deploy("x").catch((e) => e);

    expect(error.cause).toBe(offline);
    expect(error.body).toBe("Failed to fetch");
  });
});

describe("a refusal", () => {
  const refuse = (status: number, text: string) =>
    mockFetch.mockResolvedValue({ ok: false, status, text: async () => text });

  it("carries the route's sign-in reason and words", async () => {
    refuse(
      401,
      JSON.stringify({
        error: "Sign in with GitHub to build.",
        reason: "signed-out",
      })
    );

    const error = await PgServer.build({ files: [] }).catch((e) => e);

    expect(error).toBeInstanceOf(PgServerError);
    expect(error).toMatchObject({
      answered: true,
      reason: "signed-out",
      message: "Sign in with GitHub to build.",
    });
  });

  it("shows the route's words for a refusal with no reason", async () => {
    refuse(503, JSON.stringify({ error: "Sign-in is unavailable right now." }));

    const error = await PgServer.build({ files: [] }).catch((e) => e);

    expect(error.message).toBe("Sign-in is unavailable right now.");
    expect(error.reason).toBeUndefined();
  });

  it("keeps a plain-text error as it was, with no reason", async () => {
    refuse(500, "Invalid UUID");

    const error = await PgServer.build({ files: [] }).catch((e) => e);

    expect(error.reason).toBeUndefined();
    expect(error.message).toBe(
      "Server request failed (http://server.test/build): Invalid UUID"
    );
  });
});
