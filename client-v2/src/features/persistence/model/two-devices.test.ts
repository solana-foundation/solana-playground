import { PgProjectSync } from "./project-sync";
import { PgSyncClient } from "./sync-client";
import { syncProjectsFromServer } from "./project-restore";
import { PgSession } from "../../auth";
import { PgExplorer } from "../../../utils/explorer/explorer";

/**
 * A tutorial started on one browser turns up on another.
 *
 * The two halves are unit-tested either side of the wire, and both were
 * individually fine while the feature did not work at all: nothing uploaded a
 * project that had not been typed in since signing in, and what did upload
 * named itself by its id, so the tutorial arrived as a workspace called
 * `tut:hello-anchor` -- which `PgTutorial` does not recognise as the tutorial.
 * Neither shows up in a test of one side.
 *
 * The server here is a stand-in that keeps the `/api/projects` contract. The
 * real one is covered against a real database in
 * `src/features/persistence/server/projects.test.mjs`; what is under test on
 * this side is the two devices' behaviour around it.
 */

interface StoredProject {
  id: string;
  name: string;
  kind: string;
  snapshot: unknown;
  updatedAt: string;
}

/** Stands in for `/api/projects`, keeping only what the clients rely on */
const server = new Map<string, StoredProject>();

const fakeFetch = async (url: string, init?: RequestInit) => {
  if (url === "/api/sync") {
    return { ok: true, json: async () => ({ enabled: true, db: "ok" }) };
  }

  if (init?.method === "PUT") {
    const body = JSON.parse(init.body as string);
    const stored = {
      id: body.id,
      name: body.name,
      kind: body.kind,
      snapshot: body.snapshot,
      updatedAt: new Date().toISOString(),
    };
    server.set(stored.id, stored);
    return { ok: true, json: async () => ({ updatedAt: stored.updatedAt }) };
  }

  const id = new URL(url, "http://x").searchParams.get("id");
  if (id) {
    const project = server.get(id);
    return project
      ? { ok: true, json: async () => ({ project }) }
      : { ok: false, status: 404, json: async () => ({}) };
  }
  return {
    ok: true,
    json: async () => ({ projects: [...server.values()] }),
  };
};

const signedIn = () =>
  PgSession.refreshWith({ id: "u1", name: null, image: null, login: null });

/** Point the module statics at a device with this one workspace open */
const asDevice = (workspaces: Array<{ id: string; name: string }>) => {
  const current = workspaces[0];
  jest
    .spyOn(PgExplorer, "currentWorkspaceId", "get")
    .mockReturnValue(current?.id);
  jest
    .spyOn(PgExplorer, "currentWorkspaceName", "get")
    .mockReturnValue(current?.name);
  jest
    .spyOn(PgExplorer, "allWorkspaceNames", "get")
    .mockReturnValue(workspaces.map((w) => w.name));
  jest
    .spyOn(PgExplorer, "workspaceIdOf")
    .mockImplementation(
      (name) => workspaces.find((w) => w.name === name)?.id as string
    );
  jest
    .spyOn(PgExplorer, "workspaceNameOf")
    .mockImplementation(
      (id) => workspaces.find((w) => w.id === id)?.name as string
    );
  jest
    .spyOn(PgExplorer, "getAllFiles")
    .mockReturnValue(
      current ? [[`/${current.name}/src/lib.rs`, "declare_id!();"]] : []
    );
  return jest
    .spyOn(PgExplorer, "importWorkspace")
    .mockResolvedValue(undefined as never);
};

describe("a tutorial started on one browser, opened on another", () => {
  beforeEach(() => {
    server.clear();
    PgSession.reset();
    PgSyncClient.reset();
    PgProjectSync.reset();
    global.fetch = fakeFetch as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it("arrives under the name the user knows it by", async () => {
    // Device one: the tutorial is open, and signing in hands it over
    asDevice([{ id: "tut:hello-anchor", name: "Hello Anchor" }]);
    await signedIn();
    expect(await PgProjectSync.pushCurrent()).toBe("ok");

    // Device two: a different browser, nothing local, same account
    PgProjectSync.reset();
    jest.restoreAllMocks();
    const importWorkspace = asDevice([]);
    await signedIn();

    expect((await syncProjectsFromServer()).imported).toEqual(["Hello Anchor"]);
    expect(importWorkspace).toHaveBeenCalledWith("Hello Anchor", {
      id: "tut:hello-anchor",
      files: { "src/lib.rs": "declare_id!();" },
    });
  });

  it("is not handed over twice when the second browser already has it", async () => {
    asDevice([{ id: "tut:hello-anchor", name: "Hello Anchor" }]);
    await signedIn();
    await PgProjectSync.pushCurrent();

    PgProjectSync.reset();
    jest.restoreAllMocks();
    const importWorkspace = asDevice([
      { id: "tut:hello-anchor", name: "Hello Anchor" },
    ]);
    await signedIn();

    expect((await syncProjectsFromServer()).imported).toEqual([]);
    expect(importWorkspace).not.toHaveBeenCalled();
  });
});

describe("the server's copy wins over whatever is on this device", () => {
  beforeEach(() => {
    server.clear();
    PgSession.reset();
    PgSyncClient.reset();
    PgProjectSync.reset();
    global.fetch = fakeFetch as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  /** What device one left on the server */
  const seedServer = async () => {
    asDevice([{ id: "tut:hello-anchor", name: "Hello Anchor" }]);
    await signedIn();
    await PgProjectSync.pushCurrent();
    PgProjectSync.reset();
    jest.restoreAllMocks();
  };

  it("replaces a local project the server also has", async () => {
    await seedServer();

    // The second browser opened the tutorial by link, so it has its own blank
    // copy under the same derived id. It is not a second session editing --
    // it is a device that has never seen the real one.
    const replace = jest
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockResolvedValue(undefined as never);
    asDevice([{ id: "tut:hello-anchor", name: "Hello Anchor" }]);
    await signedIn();

    const result = await syncProjectsFromServer();

    expect(replace).toHaveBeenCalledWith("Hello Anchor", {
      "src/lib.rs": "declare_id!();",
    });
    expect(result.replaced).toEqual(["Hello Anchor"]);
  });

  it("still imports one this device has never had", async () => {
    await seedServer();

    const importWorkspace = asDevice([]);
    await signedIn();

    const result = await syncProjectsFromServer();

    expect(result.imported).toEqual(["Hello Anchor"]);
    expect(importWorkspace).toHaveBeenCalled();
  });

  it("names the most recently touched project, so it can be opened", async () => {
    asDevice([{ id: "older", name: "Older" }]);
    await signedIn();
    await PgProjectSync.pushCurrent();
    jest.restoreAllMocks();
    asDevice([{ id: "newer", name: "Newer" }]);
    await PgProjectSync.pushCurrent();
    // Make the order unambiguous whatever the clock did
    server.get("newer")!.updatedAt = "2026-01-02T00:00:00.000Z";
    server.get("older")!.updatedAt = "2026-01-01T00:00:00.000Z";

    PgProjectSync.reset();
    jest.restoreAllMocks();
    asDevice([]);
    await signedIn();

    expect((await syncProjectsFromServer()).latest).toBe("Newer");
  });

  it("leaves nothing to push back once it has taken the server's copy", async () => {
    await seedServer();

    jest
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockResolvedValue(undefined as never);
    asDevice([{ id: "tut:hello-anchor", name: "Hello Anchor" }]);
    await signedIn();
    await syncProjectsFromServer();

    // Pushing what was just pulled would bump the row for no reason, and on
    // the other device would look like this one had edited it
    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
  });
});
