import { PgProjectSync } from "./project-sync";
import { PgSyncClient } from "./sync-client";
import { PgSession } from "../../auth";
import { PgExplorer } from "../../../utils/explorer/explorer";

const okProbe = { ok: true, json: async () => ({ enabled: true, db: "ok" }) };

const signedIn = () =>
  PgSession.refreshWith({ id: "u1", name: null, image: null, login: null });

describe("PgProjectSync", () => {
  beforeEach(() => {
    PgSession.reset();
    PgSyncClient.reset();
    PgProjectSync.reset();
  });

  it("skips entirely when signed out", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    expect(await PgProjectSync.push("p1", { files: {} })).toBe("skipped");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("skips an unchanged snapshot rather than re-uploading it", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({
            ok: true,
            json: async () => ({ updatedAt: "t1" }),
          })
    ) as unknown as typeof fetch;
    await signedIn();

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe("ok");
    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "skipped"
    );
  });

  it("reports a conflict instead of overwriting a newer server copy", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({ conflict: true, updatedAt: "t9" }),
          })
    ) as unknown as typeof fetch;
    await signedIn();
    const seen: string[] = [];
    PgProjectSync.onDidConflict((id) => seen.push(id));
    // Having read the row is what makes a refusal mean "someone else wrote
    // since"; without it, it only means this device has not read yet
    PgProjectSync.seen("p1", "one", "t1");

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "conflict"
    );
    expect(seen).toEqual(["p1"]);
  });

  it("retries after a conflict instead of treating it as unchanged", async () => {
    let status = 409;
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({
            ok: status === 200,
            status,
            json: async () =>
              status === 200
                ? { updatedAt: "t2" }
                : { conflict: true, updatedAt: "t9" },
          })
    ) as unknown as typeof fetch;
    await signedIn();

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "conflict"
    );
    // The same snapshot must still be offered once the conflict is resolved --
    // remembering its hash would strand the project permanently out of sync
    status = 200;
    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe("ok");
  });

  it("lists nothing when signed out, rather than calling the server", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    expect(await PgProjectSync.list()).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("lists the server's projects", async () => {
    const projects = [
      { id: "p1", name: "one", kind: "project", updatedAt: "t1" },
    ];
    global.fetch = jest
      .fn()
      .mockImplementation((url: string) =>
        url === "/api/sync"
          ? Promise.resolve(okProbe)
          : Promise.resolve({ ok: true, json: async () => ({ projects }) })
      ) as unknown as typeof fetch;
    await signedIn();

    expect(await PgProjectSync.list()).toEqual(projects);
  });

  it("remembers the server's token when it fetches a project, so the next push is not a conflict", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url === "/api/sync") return Promise.resolve(okProbe);
      if (url.includes("id=p1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            project: {
              id: "p1",
              name: "one",
              kind: "project",
              snapshot: { files: {} },
              updatedAt: "t7",
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ updatedAt: "t8" }),
      });
    }) as unknown as typeof fetch;
    await signedIn();

    const fetched = await PgProjectSync.fetch("p1");
    expect(fetched?.updatedAt).toBe("t7");

    await PgProjectSync.push("p1", { files: { a: "1" } });
    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls.at(-1)![1].body
    );
    expect(body.baseUpdatedAt).toBe("t7");
    expect(body.name).toBe("one");
  });
});

describe("PgProjectSync.pushCurrent", () => {
  const okPush = { ok: true, json: async () => ({ updatedAt: "t1" }) };

  const asWorkspace = (id: string | undefined, name: string | undefined) => {
    jest.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(id);
    jest.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(name);
    jest
      .spyOn(PgExplorer, "getAllFiles")
      .mockReturnValue([[`/${name}/src/lib.rs`, "fn main() {}"]]);
  };

  const body = () =>
    JSON.parse((global.fetch as jest.Mock).mock.calls.at(-1)![1].body);

  beforeEach(() => {
    PgSession.reset();
    PgSyncClient.reset();
    PgProjectSync.reset();
    global.fetch = jest
      .fn()
      .mockImplementation((url: string) =>
        url === "/api/sync" ? Promise.resolve(okProbe) : Promise.resolve(okPush)
      ) as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it("uploads the workspace the user is looking at", async () => {
    asWorkspace("tut:hello-anchor", "Hello Anchor");
    await signedIn();

    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    expect(body().id).toBe("tut:hello-anchor");
    expect(body().snapshot.files["src/lib.rs"]).toBe("fn main() {}");
  });

  it("names it as the user sees it, not by its id", async () => {
    // The id is all the origin device had to go on, so a tutorial arrived on
    // the second browser called "tut:hello-anchor" -- a name `PgTutorial` does
    // not recognise, leaving the tutorial looking unstarted there
    asWorkspace("tut:hello-anchor", "Hello Anchor");
    await signedIn();

    await PgProjectSync.pushCurrent();
    expect(body().name).toBe("Hello Anchor");
  });

  it("does nothing when there is no workspace to push", async () => {
    asWorkspace(undefined, undefined);
    await signedIn();

    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
    expect(global.fetch).not.toHaveBeenCalledWith(
      "/api/projects",
      expect.anything()
    );
  });
});

describe("what counts as a conflict", () => {
  const conflict = { ok: false, status: 409, json: async () => ({}) };

  beforeEach(() => {
    PgSession.reset();
    PgSyncClient.reset();
    PgProjectSync.reset();
  });

  it("stays quiet when refused a project it has never read", async () => {
    // A refusal with no token of our own means this device has not caught up
    // yet, not that two sessions are editing. Telling the user their other
    // device changed the project -- with a Reload that cannot help, because
    // the very next load does the same thing -- is the false alarm.
    global.fetch = jest
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(url === "/api/sync" ? okProbe : conflict)
      ) as unknown as typeof fetch;
    await signedIn();

    const seen: string[] = [];
    PgProjectSync.onDidConflict((id) => seen.push(id));

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "conflict"
    );
    expect(seen).toEqual([]);
  });

  it("speaks up when the row moved under a device that had read it", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url === "/api/sync") return Promise.resolve(okProbe);
      if (url.includes("id=p1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            project: {
              id: "p1",
              name: "one",
              kind: "project",
              snapshot: { files: {} },
              updatedAt: "t7",
            },
          }),
        });
      }
      return Promise.resolve(conflict);
    }) as unknown as typeof fetch;
    await signedIn();

    const seen: string[] = [];
    PgProjectSync.onDidConflict((id) => seen.push(id));

    await PgProjectSync.fetch("p1");
    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "conflict"
    );
    expect(seen).toEqual(["p1"]);
  });
});

describe("holding pushes until the account is reconciled", () => {
  beforeEach(() => {
    PgSession.reset();
    PgSyncClient.reset();
    PgProjectSync.reset();
    global.fetch = jest
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url === "/api/sync"
            ? okProbe
            : { ok: true, json: async () => ({ updatedAt: "t1" }) }
        )
      ) as unknown as typeof fetch;
  });

  it("does not let a push out before the first reconcile", async () => {
    await signedIn();
    PgProjectSync.holdPushes();

    let done = false;
    const push = PgProjectSync.push("p1", { files: { a: "1" } }).then((r) => {
      done = true;
      return r;
    });
    await Promise.resolve();
    expect(done).toBe(false);

    PgProjectSync.releasePushes();
    expect(await push).toBe("ok");
  });

  it("is inert once released, so later pushes go straight out", async () => {
    await signedIn();
    PgProjectSync.holdPushes();
    PgProjectSync.releasePushes();

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe("ok");
  });

  it("holds nothing by default, so a caller that never reconciles still works", async () => {
    await signedIn();
    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe("ok");
  });
});
