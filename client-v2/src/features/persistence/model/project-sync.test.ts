import type { Mock } from "vitest";
import { PgProjectSync } from "./project-sync";
import { PgEditorModels } from "./editor-models";
import { hashFiles } from "./snapshot";
import { PgSyncBase } from "./sync-base";
import { PgSyncClient } from "./sync-client";
import { PgSyncMark } from "./sync-mark";
import { PgThreadIndex } from "./thread-index";
import { PgSession } from "../../auth";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgFs } from "../../../utils/explorer/fs";
import { PgWorkspace } from "../../../utils/explorer/workspace";

// Reconcile, adopt and merge reload the open workspace from disk through
// `reloadCurrentFromDisk`, which drops Monaco's cached models -- and
// `monaco-editor` cannot load under jsdom, so every test in this file goes
// through this stand-in instead.
vi.mock("./editor-models", () => ({
  PgEditorModels: {
    valueOf: vi.fn(async () => null),
    drop: vi.fn(async () => {}),
    dropUnder: vi.fn(async () => {}),
    anyEditedUnder: vi.fn(async () => false),
  },
}));

/**
 * A stubbed `fetch` response.
 *
 * Named rather than inferred: a stub shared between a ternary's two branches
 * and a `vi.fn()` whose own return is `any` gives TypeScript no fixed point
 * to infer `json` from.
 */
type StubResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<Record<string, unknown>>;
};

const okProbe: StubResponse = {
  ok: true,
  json: async () => ({ enabled: true, db: "ok" }),
};

const signedIn = () =>
  PgSession.refreshWith({ id: "u1", name: null, image: null, login: null });

/** The in-memory stand-in from `setupTests`, where marks land */
const storedFiles = () =>
  (PgFs as unknown as { __files: Map<string, string> }).__files;

const reset = () => {
  PgSession.reset();
  PgSyncClient.reset();
  PgProjectSync.reset();
  PgSyncBase.reset();
  storedFiles().clear();
  // The answers the factory gives: `mockReset` (see `vitest.config.ts`)
  // restores them before each test anyway, and they are restated here so
  // the test reads on its own. `valueOf` must answer `null`, not
  // `undefined`, which reads as "someone is typing in it".
  (PgEditorModels.valueOf as Mock).mockResolvedValue(null);
  (PgEditorModels.drop as Mock).mockResolvedValue(undefined);
  (PgEditorModels.dropUnder as Mock).mockResolvedValue(undefined);
};

/** The body of the most recent request */
const lastBody = () =>
  JSON.parse((global.fetch as Mock).mock.calls.at(-1)![1].body);

/** This device and the server agreed on `files`, under `name` */
const agreedOn = async (
  projectId: string,
  name: string,
  files: Record<string, string>
) =>
  PgSyncMark.write(projectId, {
    files: await hashFiles({ files }),
    name,
    updatedAt: "t1",
    dirty: false,
  });

const putCalls = () =>
  (global.fetch as Mock).mock.calls.filter(
    ([url, init]) => url === "/api/projects" && init?.method === "PUT"
  );

describe("PgProjectSync", () => {
  beforeEach(reset);

  it("skips entirely when signed out", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    expect(await PgProjectSync.push("p1", { files: {} })).toBe("skipped");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an empty snapshot whoever pushes it", async () => {
    // Not only the editor's push: reconcile and an answer to the banner read
    // their snapshot off the same store, and can land in the same window
    global.fetch = vi.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({
            ok: true,
            json: async () => ({ updatedAt: "t2" }),
          })
    ) as unknown as typeof fetch;
    await signedIn();
    await agreedOn("p1", "one", { a: "1" });

    expect(
      await PgProjectSync.push("p1", { files: {} }, "one", { immediate: true })
    ).toBe("skipped");
    expect(putCalls()).toHaveLength(0);
  });

  it("skips an unchanged snapshot rather than re-uploading it", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) =>
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

  it("records what the server accepted, so the next push is a swap against it", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({
            ok: true,
            json: async () => ({ updatedAt: "t1" }),
          })
    ) as unknown as typeof fetch;
    await signedIn();

    await PgProjectSync.push("p1", { files: { a: "1" } }, "one");
    await PgProjectSync.push("p1", { files: { a: "2" } }, "one");

    expect(lastBody().baseUpdatedAt).toBe("t1");
    expect(lastBody().name).toBe("one");
  });

  it("survives a reload: the mark is read back, not rebuilt from memory", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({
            ok: true,
            json: async () => ({ updatedAt: "t1" }),
          })
    ) as unknown as typeof fetch;
    await signedIn();
    await PgProjectSync.push("p1", { files: { a: "1" } });

    // What a reload does to this module: every in-memory map goes, and only
    // what was written to storage is left. Before marks were persisted, this
    // is exactly where the ability to tell "behind" from "ahead" was lost.
    PgProjectSync.reset();
    await signedIn();

    expect(await PgSyncMark.read("p1")).toEqual({
      files: { a: expect.any(String) },
      name: "p1",
      updatedAt: "t1",
      dirty: false,
    });
  });

  it("skips a rewrite of identical content, however dirty the mark says it is", async () => {
    // `dirty` is set by any write at all, and `PgProgramInfo` rewrites
    // `program-info.json` with the content it already had on every load. When
    // that forced an upload, every reload bumped the row -- and a bumped row
    // is exactly what the *other* browser reads as "changed elsewhere", so two
    // idle browsers generated conflicts against each other.
    global.fetch = vi.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({
            ok: true,
            json: async () => ({ updatedAt: "t1" }),
          })
    ) as unknown as typeof fetch;
    await signedIn();

    await PgProjectSync.push("p1", { files: { a: "1" } }, "one");
    await PgSyncMark.markDirty("p1");
    expect((await PgSyncMark.read("p1"))?.dirty).toBe(true);

    expect(await PgProjectSync.push("p1", { files: { a: "1" } }, "one")).toBe(
      "skipped"
    );
  });

  it("uploads a rename, which changes no bytes at all", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({
            ok: true,
            json: async () => ({ updatedAt: "t1" }),
          })
    ) as unknown as typeof fetch;
    await signedIn();

    await PgProjectSync.push("p1", { files: { a: "1" } }, "one");
    expect(await PgProjectSync.push("p1", { files: { a: "1" } }, "two")).toBe(
      "ok"
    );
    expect(lastBody().name).toBe("two");
  });

  it("keeps marks apart per account", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({
            ok: true,
            json: async () => ({ updatedAt: "t1" }),
          })
    ) as unknown as typeof fetch;

    // A tutorial's id is derived from its name, so it is byte-identical in
    // every account. Sharing marks would have the second user's push checked
    // against the first user's token, and refused for good.
    await signedIn();
    await PgProjectSync.push("tut:hello", { files: { a: "1" } });
    expect(await PgSyncMark.read("tut:hello")).not.toBeNull();

    await PgSession.refreshWith({
      id: "u2",
      name: null,
      image: null,
      login: null,
    });
    expect(await PgSyncMark.read("tut:hello")).toBeNull();
  });

  it("lists nothing when signed out, rather than calling the server", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    expect(await PgProjectSync.list()).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  /** Sync is up; the list request itself answers with `list` */
  const listAnswers = (list: () => Promise<unknown>) => {
    global.fetch = vi
      .fn()
      .mockImplementation((url: string) =>
        url === "/api/sync" ? Promise.resolve(okProbe) : list()
      ) as unknown as typeof fetch;
  };

  const unreadable: [string, () => Promise<unknown>][] = [
    ["the network is down", () => Promise.reject(new TypeError("offline"))],
    [
      "the session has expired",
      () => Promise.resolve({ ok: false, status: 401 }),
    ],
    ["the server fails", () => Promise.resolve({ ok: false, status: 500 })],
    [
      "the answer is not a list",
      () => Promise.resolve({ ok: true, json: async () => ({}) }),
    ],
  ];
  for (const [when, list] of unreadable) {
    it(`tells an unreadable list from an empty one when ${when}`, async () => {
      listAnswers(list);
      await signedIn();

      expect(await PgProjectSync.list()).toBeNull();
    });
  }

  it("lists an account that holds nothing as empty", async () => {
    listAnswers(() =>
      Promise.resolve({ ok: true, json: async () => ({ projects: [] }) })
    );
    await signedIn();

    expect(await PgProjectSync.list()).toEqual([]);
  });

  it("lists the server's projects", async () => {
    const projects = [
      { id: "p1", name: "one", kind: "project", updatedAt: "t1" },
    ];
    global.fetch = vi
      .fn()
      .mockImplementation((url: string) =>
        url === "/api/sync"
          ? Promise.resolve(okProbe)
          : Promise.resolve({ ok: true, json: async () => ({ projects }) })
      ) as unknown as typeof fetch;
    await signedIn();

    expect(await PgProjectSync.list()).toEqual(projects);
  });

  describe("requests made while holding the lock", () => {
    // Every other tab's sync waits behind the lock, and `fetch` never gives
    // up by itself -- so each request made inside it carries a timeout
    const signal = new AbortController().signal;
    const original = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");

    beforeEach(() => {
      Object.defineProperty(AbortSignal, "timeout", {
        value: vi.fn(() => signal),
        configurable: true,
        writable: true,
      });
      global.fetch = vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url === "/api/sync"
            ? okProbe
            : {
                ok: true,
                json: async () => ({
                  projects: [],
                  project: { id: "p1", name: "one", snapshot: null },
                  updatedAt: "t1",
                }),
              }
        )
      ) as unknown as typeof fetch;
    });

    afterEach(() => {
      if (original) Object.defineProperty(AbortSignal, "timeout", original);
      else delete (AbortSignal as { timeout?: unknown }).timeout;
    });

    const initOf = (match: (url: string, init?: RequestInit) => boolean) =>
      (global.fetch as Mock).mock.calls.find(([url, init]) =>
        match(url, init)
      )?.[1] as RequestInit | undefined;

    it("times out the upload", async () => {
      await signedIn();
      await PgProjectSync.push("p1", { files: { "src/lib.rs": "x" } }, "one");

      expect(initOf((_, init) => init?.method === "PUT")?.signal).toBe(signal);
    });

    it("times out the list", async () => {
      await signedIn();
      await PgProjectSync.list();

      expect(initOf((url) => url === "/api/projects")?.signal).toBe(signal);
    });

    it("times out reading one project", async () => {
      await signedIn();
      await PgProjectSync.fetch("p1");

      expect(initOf((url) => url.startsWith("/api/projects?id="))?.signal).toBe(
        signal
      );
    });
  });

  const okServer = () =>
    (global.fetch = vi.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({
            ok: true,
            json: async () => ({ updatedAt: "t1" }),
          })
    ) as unknown as typeof fetch);

  it("sends the whole file set the first time", async () => {
    okServer();
    await signedIn();
    await PgProjectSync.push("p1", { files: { a: "1", b: "2" } });
    expect(lastBody()).toMatchObject({ files: { a: "1", b: "2" } });
    expect(lastBody().changed).toBeUndefined();
  });

  it("sends only what changed after that", async () => {
    okServer();
    await signedIn();
    await PgProjectSync.push("p1", { files: { a: "1", b: "2", c: "3" } });
    await PgProjectSync.push("p1", { files: { a: "1", b: "9", d: "4" } });
    expect(lastBody()).toMatchObject({
      changed: { b: "9", d: "4" },
      removed: ["c"],
      baseUpdatedAt: "t1",
    });
    expect(lastBody().files).toBeUndefined();
  });

  it("keeps what a file held at the last agreement, even while a question is open", async () => {
    // Pushes stop while the banner is up, and the user keeps typing. When
    // they answer, the merge needs these files' base content, and the only
    // moment to take it was before the edit went unsent.
    okServer();
    await signedIn();
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("p1");
    await PgProjectSync.push("p1", { files: { a: "one" } });

    PgProjectSync.raise({ projectId: "p1", kind: "divergent" });
    expect(await PgProjectSync.push("p1", { files: { a: "two" } })).toBe(
      "skipped"
    );

    expect((await PgSyncBase.read("p1")).a?.content).toBe("one");
  });
});

describe("a conflict is asked once, not retried forever", () => {
  const refusal: StubResponse = {
    ok: false,
    status: 409,
    json: async () => ({ conflict: true, updatedAt: "t9" }),
  };

  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());

  it("stops pushing the project until the user has answered", async () => {
    // The bug this replaces: the 409 left the stale token in place and did not
    // record the hash, so the editor's debounce re-sent the same doomed swap
    // every few seconds for the life of the page, and the project never synced
    // again.
    global.fetch = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(url === "/api/sync" ? okProbe : refusal)
      ) as unknown as typeof fetch;
    await signedIn();

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "conflict"
    );
    expect(await PgProjectSync.push("p1", { files: { a: "2" } })).toBe(
      "skipped"
    );
    expect(await PgProjectSync.push("p1", { files: { a: "3" } })).toBe(
      "skipped"
    );

    expect(putCalls()).toHaveLength(1);
  });

  it("leaves other projects alone", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url === "/api/sync") return Promise.resolve(okProbe);
      return Promise.resolve(
        JSON.parse(init.body).id === "p1"
          ? refusal
          : { ok: true, json: async () => ({ updatedAt: "t2" }) }
      );
    }) as unknown as typeof fetch;
    await signedIn();

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "conflict"
    );
    expect(await PgProjectSync.push("p2", { files: { a: "1" } })).toBe("ok");
  });

  it("announces the conflict, and announces it being settled", async () => {
    // The banner had no way to hear the second half, so once shown it stayed
    // up for the rest of the session -- over unrelated projects included.
    let status = 409;
    global.fetch = vi.fn().mockImplementation((url: string) =>
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

    let changes = 0;
    PgProjectSync.onDidChangeConflicts(() => changes++);

    await PgProjectSync.push("p1", { files: { a: "1" } });
    expect(changes).toBe(1);
    expect(PgProjectSync.conflictFor("p1")).toEqual({
      projectId: "p1",
      kind: "divergent",
    });

    // Settled the way the banner settles a refusal: the user answers, and the
    // push that follows is accepted
    status = 200;
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue("one");
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("one");
    // Off the store, which is what the retry's snapshot reads
    storedFiles().set("/one/a", "2");
    expect(await PgProjectSync.resolve("p1", "retry")).toBe(true);
    expect(changes).toBe(2);
    expect(PgProjectSync.conflictFor("p1")).toBeNull();
  });

  it("still asks when the merge a refusal starts cannot read the server", async () => {
    // Offline since the refusal. Returning without raising anything would
    // leave pushes running, and every debounce would send the same doomed
    // swap.
    global.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url === "/api/sync") return Promise.resolve(okProbe);
      if (init?.method === "PUT") return Promise.resolve(refusal);
      return Promise.reject(new TypeError("Failed to fetch"));
    }) as unknown as typeof fetch;
    await signedIn();
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue("one");

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "conflict"
    );
    expect(PgProjectSync.conflictFor("p1")).toEqual({
      projectId: "p1",
      kind: "divergent",
    });
    expect(await PgProjectSync.push("p1", { files: { a: "2" } })).toBe(
      "skipped"
    );
    expect(putCalls()).toHaveLength(1);
  });

  it("asks about the delete when the refused row turns out to be gone", async () => {
    // A 409 on a tombstoned or missing row, and the merge's read of it a 404.
    // Asked as a divergence, both answers merge against a server that has
    // nothing to merge with and fail, so the banner could never be cleared --
    // and "Keep as a new project", the answer that works, was never offered.
    global.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url === "/api/sync") return Promise.resolve(okProbe);
      if (init?.method === "PUT") return Promise.resolve(refusal);
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({}),
      });
    }) as unknown as typeof fetch;
    await signedIn();
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue("one");

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "conflict"
    );
    expect(PgProjectSync.conflictFor("p1")).toEqual({
      projectId: "p1",
      kind: "deleted-elsewhere",
    });
    expect(await PgProjectSync.push("p1", { files: { a: "2" } })).toBe(
      "skipped"
    );
    expect(putCalls()).toHaveLength(1);
  });
});

describe("resolving a conflict", () => {
  const asWorkspace = (id: string, name: string) => {
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(id);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(name);
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue(name);
    storedFiles().set(`/${name}/src/lib.rs`, "mine");
  };

  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());

  it("keeps this device's version as a swap against the server's, not an overwrite", async () => {
    // There is no unconditional write any more. Keeping this device's side
    // makes the server's copy the agreement first, so the upload is an
    // ordinary compare-and-swap that a third write can still refuse.
    let status = 409;
    global.fetch = vi.fn().mockImplementation((url: string, init: any) => {
      if (url === "/api/sync") return Promise.resolve(okProbe);
      if (init?.method !== "PUT") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            project: {
              id: "p1",
              name: "mine",
              kind: "project",
              snapshot: { files: { "src/lib.rs": "theirs" } },
              updatedAt: "t9",
            },
          }),
        });
      }
      return Promise.resolve({
        ok: status === 200,
        status,
        json: async () =>
          status === 200
            ? { updatedAt: "t10" }
            : { conflict: true, updatedAt: "t9" },
      });
    }) as unknown as typeof fetch;
    await signedIn();
    asWorkspace("p1", "mine");

    await PgProjectSync.pushCurrent();
    const hashes = {
      local: await hashFiles({ files: { "src/lib.rs": "mine" } }),
      server: await hashFiles({ files: { "src/lib.rs": "theirs" } }),
    };
    expect(PgProjectSync.conflictFor("p1")).toEqual({
      projectId: "p1",
      kind: "divergent",
      paths: ["src/lib.rs"],
      // No mark, so no base: the file is one question
      files: [
        {
          kind: "whole",
          path: "src/lib.rs",
          local: "mine",
          server: "theirs",
          localHash: hashes.local["src/lib.rs"],
          serverHash: hashes.server["src/lib.rs"],
        },
      ],
    });

    status = 200;
    expect(await PgProjectSync.resolve("p1", "keep-local")).toBe(true);

    const body = lastBody();
    expect(body.force).toBeUndefined();
    expect(body.baseUpdatedAt).toBe("t9");
    expect(body.changed).toEqual({ "src/lib.rs": "mine" });
    expect(PgProjectSync.conflictFor("p1")).toBeNull();
  });

  it("takes the server's files when the user picks the other version", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/sync") return Promise.resolve(okProbe);
      if (url.includes("id=p1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            project: {
              id: "p1",
              name: "mine",
              kind: "project",
              snapshot: { files: { "src/lib.rs": "theirs" } },
              updatedAt: "t9",
            },
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 409,
        json: async () => ({ conflict: true, updatedAt: "t9" }),
      });
    }) as unknown as typeof fetch;
    await signedIn();
    asWorkspace("p1", "mine");
    const replace = vi
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockResolvedValue(undefined);
    vi.spyOn(PgExplorer, "switchWorkspace").mockResolvedValue(undefined);

    await PgProjectSync.pushCurrent();
    expect(await PgProjectSync.resolve("p1", "take-server")).toBe(true);

    expect(replace).toHaveBeenCalledWith("mine", { "src/lib.rs": "theirs" });
    expect(PgProjectSync.conflictFor("p1")).toBeNull();
    // The mark now says the server's copy, so nothing is pushed back up
    expect((await PgSyncMark.read("p1"))?.updatedAt).toBe("t9");
  });

  it("re-reads the workspace it just replaced, so the editor stops showing the old code", async () => {
    // `replaceWorkspaceFiles` writes to the backing store and leaves the
    // in-memory copy alone, and only the *current* workspace has one. Without
    // a forced re-read the user keeps looking at the version they chose to
    // discard -- and worse, the next debounce uploads it back over the one
    // they chose to keep.
    //
    // `switchWorkspace` is not enough on its own: `_initCurrentWorkspace`
    // skips when the workspace is already the initialized one.
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/sync") return Promise.resolve(okProbe);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          project: {
            id: "p1",
            name: "mine",
            kind: "project",
            snapshot: { files: { "src/lib.rs": "theirs" } },
            updatedAt: "t9",
          },
        }),
      });
    }) as unknown as typeof fetch;
    await signedIn();
    asWorkspace("p1", "mine");
    // Adopting re-checks that the local copy is the last agreement
    await agreedOn("p1", "mine", { "src/lib.rs": "mine" });
    vi.spyOn(PgExplorer, "replaceWorkspaceFiles").mockResolvedValue(undefined);
    const reload = vi
      .spyOn(PgExplorer, "switchWorkspace")
      .mockResolvedValue(undefined);
    // What the store holds is what the clean check reads
    storedFiles().set("/mine/src/lib.rs", "mine");

    expect(await PgProjectSync.adopt("p1")).toBe("mine");

    expect(reload).toHaveBeenCalledWith("mine");
  });

  it("does not re-read a project the user is not looking at", async () => {
    // Only the current workspace is held in memory, so re-opening any other
    // would be a navigation the user did not ask for
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/sync") return Promise.resolve(okProbe);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          project: {
            id: "p2",
            name: "other",
            kind: "project",
            snapshot: { files: { "src/lib.rs": "theirs" } },
            updatedAt: "t9",
          },
        }),
      });
    }) as unknown as typeof fetch;
    await signedIn();
    asWorkspace("p1", "mine");
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue("other");
    storedFiles().set("/other/src/lib.rs", "old");
    await agreedOn("p2", "other", { "src/lib.rs": "old" });
    vi.spyOn(PgExplorer, "replaceWorkspaceFiles").mockResolvedValue(undefined);
    const reload = vi
      .spyOn(PgExplorer, "switchWorkspace")
      .mockResolvedValue(undefined);

    expect(await PgProjectSync.adopt("p2")).toBe("other");

    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses to empty a workspace over a malformed snapshot", async () => {
    // `replaceWorkspaceFiles` removes the directory before it discovers there
    // is nothing to write back, so an unusable snapshot is not a no-op -- it
    // is the project being deleted on every device that syncs it.
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/sync") return Promise.resolve(okProbe);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          project: {
            id: "p1",
            name: "mine",
            kind: "project",
            snapshot: { files: null },
            updatedAt: "t9",
          },
        }),
      });
    }) as unknown as typeof fetch;
    await signedIn();
    asWorkspace("p1", "mine");
    const replace = vi
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockResolvedValue(undefined);

    expect(await PgProjectSync.adopt("p1")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("resolving a conflict with content of the user's own", () => {
  const LIB = "src/lib.rs";
  /** What the account holds, and since when; changed by the tests */
  let held: Record<string, string>;
  let heldAt: string;
  /** Whether the next upload is accepted */
  let accepting: boolean;
  /**
   * Another write landing between this device's read and its upload: run
   * once, on the next upload, which it refuses
   */
  let landsFirst: (() => void) | null;

  const hashOf = async (content: string) =>
    (await hashFiles({ files: { [LIB]: content } }))[LIB];

  const serverIsUp = () =>
    vi.spyOn(global, "fetch").mockImplementation((async (
      url: string,
      init?: RequestInit
    ) => {
      if (url === "/api/sync") return okProbe;
      if (init?.method === "PUT") {
        if (landsFirst) {
          landsFirst();
          landsFirst = null;
          return {
            ok: false,
            status: 409,
            json: async () => ({ conflict: true, updatedAt: heldAt }),
          };
        }
        if (!accepting) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ conflict: true, updatedAt: heldAt }),
          };
        }
        return { ok: true, json: async () => ({ updatedAt: "t10" }) };
      }
      return {
        ok: true,
        json: async () => ({
          project: {
            id: "p1",
            name: "mine",
            kind: "project",
            snapshot: { files: held },
            updatedAt: heldAt,
          },
        }),
      };
    }) as unknown as typeof fetch);

  /**
   * This device holds "mine", the account "theirs", and a refused push has
   * raised the question
   */
  const askedAboutLib = () =>
    askedAbout({ [LIB]: "mine" }, { [LIB]: "theirs" });

  /** This device holds `mine`, the account `theirs`, and a refused push has
   * raised the question */
  const askedAbout = async (
    mine: Record<string, string>,
    theirs: Record<string, string>
  ) => {
    held = theirs;
    heldAt = "t9";
    accepting = false;
    landsFirst = null;
    serverIsUp();
    await signedIn();
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("p1");
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("mine");
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue("mine");
    for (const [path, content] of Object.entries(mine)) {
      storedFiles().set(`/mine/${path}`, content);
    }
    vi.spyOn(PgExplorer, "switchWorkspace").mockResolvedValue(undefined);
    const replace = vi
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockResolvedValue(undefined);

    expect(await PgProjectSync.pushCurrent()).toBe("conflict");
    return replace;
  };

  /** Both lines, this device's first, against the hashes the view was shown */
  const takeBoth = async () => ({
    kind: "resolved" as const,
    files: {
      [LIB]: {
        content: "mine\ntheirs",
        localHash: await hashOf("mine"),
        serverHash: await hashOf("theirs"),
      },
    },
  });

  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());

  it("writes the resolved content, records it as agreed and uploads it", async () => {
    const replace = await askedAboutLib();
    expect(PgProjectSync.conflictFor("p1")?.files).toEqual([
      {
        kind: "whole",
        path: LIB,
        local: "mine",
        server: "theirs",
        localHash: await hashOf("mine"),
        serverHash: await hashOf("theirs"),
      },
    ]);

    accepting = true;
    expect(await PgProjectSync.resolve("p1", await takeBoth())).toBe(true);

    expect(replace).toHaveBeenCalledWith("mine", { [LIB]: "mine\ntheirs" });
    const body = lastBody();
    expect(body.baseUpdatedAt).toBe("t9");
    expect(body.changed).toEqual({ [LIB]: "mine\ntheirs" });
    const mark = await PgSyncMark.read("p1");
    expect(mark?.updatedAt).toBe("t10");
    expect(mark?.files).toEqual({ [LIB]: await hashOf("mine\ntheirs") });
    expect(PgProjectSync.conflictFor("p1")).toBeNull();
  });

  it("asks again with the new copy, writing and sending nothing, when the account moved since", async () => {
    const replace = await askedAboutLib();
    const answer = await takeBoth();
    held = { [LIB]: "theirs, again" };
    heldAt = "t11";
    accepting = true;

    expect(await PgProjectSync.resolve("p1", answer)).toBe(false);

    expect(PgProjectSync.conflictFor("p1")).toEqual({
      projectId: "p1",
      kind: "divergent",
      paths: [LIB],
      files: [
        {
          kind: "whole",
          path: LIB,
          local: "mine",
          server: "theirs, again",
          localHash: await hashOf("mine"),
          serverHash: await hashOf("theirs, again"),
        },
      ],
    });
    expect(replace).not.toHaveBeenCalled();
    expect(putCalls()).toHaveLength(1);
    expect(await PgSyncMark.read("p1")).toBeNull();
  });

  it("asks again with the new copy, writing and sending nothing, when this device's copy moved since", async () => {
    const replace = await askedAboutLib();
    const answer = await takeBoth();
    storedFiles().set(`/mine/${LIB}`, "mine, edited");
    accepting = true;

    expect(await PgProjectSync.resolve("p1", answer)).toBe(false);

    expect(PgProjectSync.conflictFor("p1")?.files).toEqual([
      {
        kind: "whole",
        path: LIB,
        local: "mine, edited",
        server: "theirs",
        localHash: await hashOf("mine, edited"),
        serverHash: await hashOf("theirs"),
      },
    ]);
    expect(replace).not.toHaveBeenCalled();
    expect(putCalls()).toHaveLength(1);
    expect(await PgSyncMark.read("p1")).toBeNull();
  });

  describe("an answer about two files", () => {
    const A = "src/a.rs";
    const B = "src/b.rs";

    /** Both files answered, against the copies the question was raised on */
    const answerBoth = async () => ({
      kind: "resolved" as const,
      files: {
        [A]: {
          content: "resolved a",
          localHash: await hashOf("mine a"),
          serverHash: await hashOf("theirs a"),
        },
        [B]: {
          content: "resolved b",
          localHash: await hashOf("mine b"),
          serverHash: await hashOf("theirs b"),
        },
      },
    });

    const askedAboutBoth = () =>
      askedAbout(
        { [A]: "mine a", [B]: "mine b" },
        { [A]: "theirs a", [B]: "theirs b" }
      );

    it("applies neither file's answer when the account moved one of them, and asks again", async () => {
      const replace = await askedAboutBoth();
      const answer = await answerBoth();
      held = { [A]: "theirs a", [B]: "theirs b, again" };
      heldAt = "t11";
      accepting = true;

      expect(await PgProjectSync.resolve("p1", answer)).toBe(false);

      expect(PgProjectSync.conflictFor("p1")?.files).toEqual([
        {
          kind: "whole",
          path: A,
          local: "mine a",
          server: "theirs a",
          localHash: await hashOf("mine a"),
          serverHash: await hashOf("theirs a"),
        },
        {
          kind: "whole",
          path: B,
          local: "mine b",
          server: "theirs b, again",
          localHash: await hashOf("mine b"),
          serverHash: await hashOf("theirs b, again"),
        },
      ]);
      expect(replace).not.toHaveBeenCalled();
      expect(putCalls()).toHaveLength(1);
      expect(await PgSyncMark.read("p1")).toBeNull();
    });

    it("applies neither file's answer when one now merges on its own and the other still conflicts", async () => {
      // The other device took this device's `b`: nothing left to ask about
      // there, but the answer was about a version of it that is gone
      const replace = await askedAboutBoth();
      const answer = await answerBoth();
      held = { [A]: "theirs a", [B]: "mine b" };
      heldAt = "t11";
      accepting = true;

      expect(await PgProjectSync.resolve("p1", answer)).toBe(false);

      // Both shown again: `b` as it now merges, with nothing to decide
      expect(PgProjectSync.conflictFor("p1")).toEqual({
        projectId: "p1",
        kind: "divergent",
        paths: [A, B],
        files: [
          {
            kind: "whole",
            path: A,
            local: "mine a",
            server: "theirs a",
            localHash: await hashOf("mine a"),
            serverHash: await hashOf("theirs a"),
          },
          {
            kind: "settled",
            path: B,
            content: "mine b",
            localHash: await hashOf("mine b"),
            serverHash: await hashOf("mine b"),
          },
        ],
      });
      expect(replace).not.toHaveBeenCalled();
      expect(putCalls()).toHaveLength(1);
      expect(await PgSyncMark.read("p1")).toBeNull();
    });
  });

  it("refuses the answer, writing and sending nothing, when the answered file now merges on its own", async () => {
    // This device also added a file, which the merge then owes the account
    const NEW = "src/new.rs";
    const replace = await askedAbout(
      { [LIB]: "mine", [NEW]: "new" },
      { [LIB]: "theirs" }
    );
    const answer = await takeBoth();
    // The other device took this device's copy of the file in question
    held = { [LIB]: "mine" };
    heldAt = "t11";
    accepting = true;

    expect(await PgProjectSync.resolve("p1", answer)).toBe(false);

    // Shown again as it now stands: merged, nothing left to decide, but not
    // what the user answered about
    const settled = {
      kind: "settled" as const,
      path: LIB,
      content: "mine",
      localHash: await hashOf("mine"),
      serverHash: await hashOf("mine"),
    };
    expect(PgProjectSync.conflictFor("p1")).toEqual({
      projectId: "p1",
      kind: "divergent",
      paths: [LIB],
      files: [settled],
    });
    expect(replace).not.toHaveBeenCalled();
    expect(putCalls()).toHaveLength(1);
    expect(await PgSyncMark.read("p1")).toBeNull();

    // Applied as shown, it settles, and the merge owes the account the rest
    expect(
      await PgProjectSync.resolve("p1", {
        kind: "resolved",
        files: {
          [LIB]: {
            content: settled.content,
            localHash: settled.localHash,
            serverHash: settled.serverHash,
          },
        },
      })
    ).toBe(true);
    expect(replace).not.toHaveBeenCalled();
    const body = lastBody();
    expect(body.baseUpdatedAt).toBe("t11");
    expect(body.changed).toEqual({ [NEW]: "new" });
    expect(body.removed).toEqual([]);
    expect(PgProjectSync.conflictFor("p1")).toBeNull();
  });

  it("uploads an applied answer again over a write that landed before it, without asking", async () => {
    const OTHER = "src/other.rs";
    const replace = await askedAboutLib();
    const answer = await takeBoth();
    accepting = true;
    // The other device adds a file between this device's read and upload
    landsFirst = () => {
      held = { [LIB]: "theirs", [OTHER]: "other" };
      heldAt = "t11";
    };

    expect(await PgProjectSync.resolve("p1", answer)).toBe(true);

    // The answer is this device's copy now, merged with the newer account's
    expect(replace).toHaveBeenLastCalledWith("mine", {
      [LIB]: "mine\ntheirs",
      [OTHER]: "other",
    });
    expect(putCalls()).toHaveLength(3);
    const body = lastBody();
    expect(body.baseUpdatedAt).toBe("t11");
    expect(body.changed).toEqual({ [LIB]: "mine\ntheirs" });
    expect(body.removed).toEqual([]);
    const mark = await PgSyncMark.read("p1");
    expect(mark?.updatedAt).toBe("t10");
    expect(mark?.files).toEqual({
      [LIB]: await hashOf("mine\ntheirs"),
      [OTHER]: await hashOf("other"),
    });
    expect(PgProjectSync.conflictFor("p1")).toBeNull();
  });

  it("asks again, keeping the applied answer here, when the other device changed the same lines before its upload", async () => {
    const replace = await askedAboutLib();
    const answer = await takeBoth();
    accepting = true;
    landsFirst = () => {
      held = { [LIB]: "theirs, again" };
      heldAt = "t11";
    };

    expect(await PgProjectSync.resolve("p1", answer)).toBe(false);

    // Written here before the upload was refused, and kept: it is this
    // device's work now, and the new question is about it
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("mine", { [LIB]: "mine\ntheirs" });
    expect(putCalls()).toHaveLength(2);
    const asked = PgProjectSync.conflictFor("p1");
    expect(asked?.paths).toEqual([LIB]);
    expect(asked?.files?.[0]).toMatchObject({
      kind: "lines",
      path: LIB,
      localHash: await hashOf("mine\ntheirs"),
      serverHash: await hashOf("theirs, again"),
    });
    // The agreement is the account's copy the answer was made against
    const mark = await PgSyncMark.read("p1");
    expect(mark?.files).toEqual({ [LIB]: await hashOf("theirs") });
    expect(mark?.dirty).toBe(true);
  });

  it("asks again when the answer leaves out a file in conflict", async () => {
    const replace = await askedAboutLib();
    accepting = true;

    expect(
      await PgProjectSync.resolve("p1", { kind: "resolved", files: {} })
    ).toBe(false);

    expect(PgProjectSync.conflictFor("p1")?.paths).toEqual([LIB]);
    expect(replace).not.toHaveBeenCalled();
    expect(putCalls()).toHaveLength(1);
  });
});

describe("PgProjectSync.pushCurrent", () => {
  const okPush = { ok: true, json: async () => ({ updatedAt: "t1" }) };

  const asWorkspace = (id: string | undefined, name: string | undefined) => {
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(id);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(name);
    if (name) storedFiles().set(`/${name}/src/lib.rs`, "fn main() {}");
  };

  beforeEach(() => {
    reset();
    global.fetch = vi
      .fn()
      .mockImplementation((url: string) =>
        url === "/api/sync" ? Promise.resolve(okProbe) : Promise.resolve(okPush)
      ) as unknown as typeof fetch;
  });

  afterEach(() => vi.restoreAllMocks());

  it("uploads the workspace the user is looking at", async () => {
    asWorkspace("tut:hello-anchor", "Hello Anchor");
    await signedIn();

    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    expect(lastBody().id).toBe("tut:hello-anchor");
    expect(lastBody().files["src/lib.rs"]).toBe("fn main() {}");
  });

  it("names it as the user sees it, not by its id", async () => {
    // The id is all the origin device had to go on, so a tutorial arrived on
    // the second browser called "tut:hello-anchor" -- a name `PgTutorial` does
    // not recognise, leaving the tutorial looking unstarted there
    asWorkspace("tut:hello-anchor", "Hello Anchor");
    await signedIn();

    await PgProjectSync.pushCurrent();
    expect(lastBody().name).toBe("Hello Anchor");
  });

  it("refuses to upload an empty snapshot over a project that has one", async () => {
    // `replaceWorkspaceFiles` clears the workspace directory before writing
    // the taken snapshot back, so a push landing in that window reads
    // nothing off disk. Taking another device's copy re-opens the
    // workspace, which is precisely when a push is most likely to be
    // pending -- so the version the user asked to keep would be replaced by
    // an empty project.
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("p1");
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("mine");
    await signedIn();

    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
    expect(putCalls()).toHaveLength(0);
  });

  it("does nothing when there is no workspace to push", async () => {
    asWorkspace(undefined, undefined);
    await signedIn();

    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
    expect(putCalls()).toHaveLength(0);
  });

  it("does not upload one project's files under another's id", async () => {
    // `pushCurrent` reads `currentWorkspaceId` the moment it is called --
    // synchronously, before its first `await` -- and used to read the
    // snapshot and `currentWorkspaceName` much later, once `_ready`, the
    // push gate and the sync lock had all had their say. A switch in
    // between tore the three apart: this device's id, paired with whatever
    // project the user had switched to by the time execution resumed.
    const idSpy = vi.spyOn(PgExplorer, "currentWorkspaceId", "get");
    const nameSpy = vi.spyOn(PgExplorer, "currentWorkspaceName", "get");
    const setWorkspace = (id: string, name: string) => {
      idSpy.mockReturnValue(id);
      nameSpy.mockReturnValue(name);
      storedFiles().set(`/${name}/src/lib.rs`, `// ${name}`);
    };

    setWorkspace("a", "A");
    await signedIn();
    PgProjectSync.holdPushes();

    const push = PgProjectSync.pushCurrent();

    // The user switches projects while this push is still waiting on the
    // gate -- the same window a focus reconcile or another tab's reconcile
    // holds it open for.
    setWorkspace("b", "B");
    PgProjectSync.releasePushes();
    await push;

    const body = lastBody();
    expect(body.id).toBe("b");
    expect(body.name).toBe("B");
    expect(body.files["src/lib.rs"]).toBe("// B");
  });

  it("refuses to upload a workspace another tab renamed or deleted", async () => {
    // This tab's memory still has it, and its autosave recreated the
    // directory around the one file it wrote -- a fragment that would
    // replace the whole project on the server
    asWorkspace("p1", "mine");
    storedFiles().set(
      PgWorkspace.WORKSPACES_CONFIG_PATH,
      JSON.stringify({
        workspaces: [{ id: "p1", name: "renamed" }],
        currentId: "p1",
      })
    );
    await signedIn();

    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
    expect(putCalls()).toHaveLength(0);
  });

  it("uploads a workspace the registry on disk still has", async () => {
    asWorkspace("p1", "mine");
    storedFiles().set(
      PgWorkspace.WORKSPACES_CONFIG_PATH,
      JSON.stringify({ workspaces: [{ id: "p1", name: "mine" }] })
    );
    await signedIn();

    expect(await PgProjectSync.pushCurrent()).toBe("ok");
  });

  it("does not upload against a registry it cannot parse", async () => {
    // A config caught half-written says nothing about whether the workspace
    // is still listed, and read as "no registry" it waved the push through
    asWorkspace("p1", "mine");
    storedFiles().set(PgWorkspace.WORKSPACES_CONFIG_PATH, '{"workspaces":[');
    await signedIn();

    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
    expect(putCalls()).toHaveLength(0);
  });
});

describe("deleting a project", () => {
  beforeEach(reset);

  it("tells the server, so a reload does not bring it back", async () => {
    // The tombstone machinery, its `deleted_at` column and its "does not
    // resurrect" tests were all server-side only: nothing ever issued the
    // DELETE, so deleting a project was undone by the next reconcile.
    global.fetch = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url === "/api/sync"
            ? okProbe
            : { ok: true, json: async () => ({ deleted: true }) }
        )
      ) as unknown as typeof fetch;
    await signedIn();

    expect(await PgProjectSync.remove("p1")).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects?id=p1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

describe("holding pushes until the account is reconciled", () => {
  beforeEach(() => {
    reset();
    global.fetch = vi
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

  it("stays held until every holder has let go", async () => {
    // A reconcile and a merge hold for their own reasons and overlap. With a
    // single slot, whichever finished first opened the gate for both, and the
    // editor uploaded its pre-merge copy while the merge was still writing.
    await signedIn();
    PgProjectSync.holdPushes();
    PgProjectSync.holdPushes();

    let done = false;
    const push = PgProjectSync.push("p1", { files: { a: "1" } }).then((r) => {
      done = true;
      return r;
    });
    PgProjectSync.releasePushes();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(done).toBe(false);

    PgProjectSync.releasePushes();
    expect(await push).toBe("ok");
  });

  it("holds nothing by default, so a caller that never reconciles still works", async () => {
    await signedIn();
    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe("ok");
  });
});

describe("a refusal the user has to clear", () => {
  const asWorkspace = (id: string, name: string) => {
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(id);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(name);
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue(name);
    storedFiles().set(`/${name}/src/lib.rs`, "mine");
  };

  /** A `fetch` that answers the sync probe and hands every PUT `refusal` */
  const refusing = (refusal: StubResponse | (() => StubResponse)) =>
    (global.fetch = vi
      .fn()
      .mockImplementation((url: string) =>
        url === "/api/sync"
          ? Promise.resolve(okProbe)
          : Promise.resolve(typeof refusal === "function" ? refusal() : refusal)
      ) as unknown as typeof fetch);

  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());

  it("tells a name collision from a divergence, though both are 409", async () => {
    // The whole reason the server puts a `reason` in the body. Branching on
    // the status alone asked "keep this version or take the other" about a
    // name -- a question with no answer, which also suspends pushes until it
    // is answered.
    refusing({
      ok: false,
      status: 409,
      json: async () => ({ error: "Name already used", reason: "name-taken" }),
    });
    await signedIn();

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "conflict"
    );
    expect(PgProjectSync.conflictFor("p1")).toEqual({
      projectId: "p1",
      kind: "name-taken",
    });
  });

  it("falls back to divergent when the body says nothing", async () => {
    refusing({
      ok: false,
      status: 409,
      json: async () => {
        throw new Error("not json");
      },
    });
    await signedIn();

    await PgProjectSync.push("p1", { files: { a: "1" } });
    expect(PgProjectSync.conflictFor("p1")?.kind).toBe("divergent");
  });

  it("surfaces a workspace too large to upload instead of skipping it", async () => {
    // Previously a 413 fell through to `!response.ok`: a diagnostics line, a
    // "skipped", and a project that never synced again with nothing on screen
    // to say so.
    refusing({
      ok: false,
      status: 413,
      json: async () => ({ error: "Payload too large", reason: "too-large" }),
    });
    await signedIn();

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "conflict"
    );
    expect(PgProjectSync.conflictFor("p1")?.kind).toBe("too-large");
  });

  it("stops pushing a refused project, exactly like a divergence", async () => {
    refusing({
      ok: false,
      status: 413,
      json: async () => ({ reason: "too-large" }),
    });
    await signedIn();

    await PgProjectSync.push("p1", { files: { a: "1" } });
    expect(await PgProjectSync.push("p1", { files: { a: "2" } })).toBe(
      "skipped"
    );
    expect(putCalls()).toHaveLength(1);
  });

  it("pushes again when the user says they have fixed it", async () => {
    // The point of the retry: the conflict is what suspends pushes, so a
    // project renamed out of a collision would stay stuck without it.
    let taken = true;
    refusing(() =>
      taken
        ? {
            ok: false,
            status: 409,
            json: async () => ({ reason: "name-taken" }),
          }
        : { ok: true, status: 200, json: async () => ({ updatedAt: "t2" }) }
    );
    await signedIn();
    asWorkspace("p1", "mine");

    await PgProjectSync.pushCurrent();
    expect(PgProjectSync.conflictFor("p1")?.kind).toBe("name-taken");

    taken = false;
    expect(await PgProjectSync.resolve("p1", "retry")).toBe(true);
    expect(PgProjectSync.conflictFor("p1")).toBeNull();
    expect(putCalls()).toHaveLength(2);
  });

  it("leaves the banner up when the retry never reaches the server", async () => {
    // A failed resolution must not clear the prompt -- being offline does not
    // mean the name is free. `push` raises nothing for a request that threw,
    // so `resolve` is what puts the original question back.
    let offline = false;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/sync") return Promise.resolve(okProbe);
      if (offline) return Promise.reject(new Error("offline"));
      return Promise.resolve({
        ok: false,
        status: 409,
        json: async () => ({ reason: "name-taken" }),
      });
    }) as unknown as typeof fetch;
    await signedIn();
    asWorkspace("p1", "mine");

    await PgProjectSync.pushCurrent();
    offline = true;

    expect(await PgProjectSync.resolve("p1", "retry")).toBe(false);
    expect(PgProjectSync.conflictFor("p1")).toEqual({
      projectId: "p1",
      kind: "name-taken",
    });
  });

  it("does not retry over a directory another tab removed", async () => {
    // The banner is still up in this tab, which has not re-read the list.
    // Its snapshot reads nothing off the store, and sent, that nothing
    // replaces every file of the project on the server.
    refusing({
      ok: false,
      status: 409,
      json: async () => ({ reason: "name-taken" }),
    });
    await signedIn();
    asWorkspace("p1", "mine");
    await PgProjectSync.pushCurrent();
    storedFiles().delete("/mine/src/lib.rs");

    expect(await PgProjectSync.resolve("p1", "retry")).toBe(false);
    expect(putCalls()).toHaveLength(1);
    expect(PgProjectSync.conflictFor("p1")?.kind).toBe("name-taken");
  });

  it("does not retry a workspace another tab renamed", async () => {
    // Under its old name, the store may hold anything: a fragment an
    // autosave recreated, or a new project that took the name
    refusing({
      ok: false,
      status: 409,
      json: async () => ({ reason: "name-taken" }),
    });
    await signedIn();
    asWorkspace("p1", "mine");
    await PgProjectSync.pushCurrent();
    storedFiles().set(
      PgWorkspace.WORKSPACES_CONFIG_PATH,
      JSON.stringify({ workspaces: [{ id: "p1", name: "renamed" }] })
    );

    expect(await PgProjectSync.resolve("p1", "retry")).toBe(false);
    expect(putCalls()).toHaveLength(1);
    expect(PgProjectSync.conflictFor("p1")?.kind).toBe("name-taken");
  });

  it("asks about a delete, not a version, when the row is a tombstone", async () => {
    // Previously `divergent`: "Take the other version" had nothing to take,
    // and "Keep this version" un-deleted the project on the server
    refusing({
      ok: false,
      status: 409,
      json: async () => ({
        conflict: true,
        updatedAt: null,
        reason: "deleted",
      }),
    });
    await signedIn();
    asWorkspace("p1", "mine");

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe(
      "conflict"
    );
    expect(PgProjectSync.conflictFor("p1")).toEqual({
      projectId: "p1",
      kind: "deleted-elsewhere",
    });
  });

  it("forgets the conversation when the user finishes a delete", async () => {
    // The server tombstoned it with the project, and a tutorial started
    // again under this id must not inherit the old chat
    await signedIn();
    asWorkspace("p1", "mine");
    PgProjectSync.raise({ projectId: "p1", kind: "deleted-elsewhere" });
    vi.spyOn(PgExplorer, "deleteWorkspace").mockResolvedValue(
      undefined as never
    );
    const forget = vi.spyOn(PgThreadIndex, "forget").mockResolvedValue(true);

    expect(await PgProjectSync.resolve("p1", "delete-local")).toBe(true);
    expect(forget).toHaveBeenCalledWith("p1");
  });

  it("carries the conversation to the project the user keeps as new", async () => {
    // The chat is part of the work being kept. Under the new workspace id,
    // and a fresh thread id: the old thread is tombstoned on the server with
    // the project, so every push under it would be refused -- and the chat
    // was left behind under the deleted id, where the new project opened
    // with an empty panel.
    await signedIn();
    asWorkspace("p1", "mine");
    PgProjectSync.raise({ projectId: "p1", kind: "deleted-elsewhere" });
    storedFiles().set(
      PgWorkspace.WORKSPACES_CONFIG_PATH,
      JSON.stringify({ workspaces: [{ id: "p1", name: "mine" }] })
    );
    const importWorkspace = vi
      .spyOn(PgExplorer, "importWorkspace")
      .mockResolvedValue(undefined as never);
    const deleteWorkspace = vi
      .spyOn(PgExplorer, "deleteWorkspace")
      .mockResolvedValue(undefined as never);
    vi.spyOn(PgExplorer, "switchWorkspace").mockResolvedValue(
      undefined as never
    );
    const removeMark = vi.spyOn(PgSyncMark, "remove");
    const carry = vi.spyOn(PgThreadIndex, "carry").mockResolvedValue(true);

    expect(await PgProjectSync.resolve("p1", "keep-as-new")).toBe(true);

    const [, imported] = importWorkspace.mock.calls[0] as unknown as [
      string,
      { id: string }
    ];
    expect(carry).toHaveBeenCalledWith({ from: "p1", to: imported.id });
    expect(imported.id).not.toBe("p1");
    expect(PgProjectSync.conflictFor("p1")).toBeNull();
    // The delete event forgets the conversation of every mark whose
    // workspace is gone: the chat has to have moved, and the mark to be
    // gone, before the original is deleted
    const [deleted] = deleteWorkspace.mock.invocationCallOrder;
    expect(carry.mock.invocationCallOrder[0]).toBeLessThan(deleted);
    expect(removeMark.mock.invocationCallOrder[0]).toBeLessThan(deleted);
  });

  it("keeps the original when the conversation could not be carried", async () => {
    // Deleted anyway, its delete forgot the conversation that failed to
    // move, while the banner closed as though the work was kept
    await signedIn();
    asWorkspace("p1", "mine");
    PgProjectSync.raise({ projectId: "p1", kind: "deleted-elsewhere" });
    vi.spyOn(PgExplorer, "importWorkspace").mockResolvedValue(
      undefined as never
    );
    const deleteWorkspace = vi
      .spyOn(PgExplorer, "deleteWorkspace")
      .mockResolvedValue(undefined as never);
    vi.spyOn(PgThreadIndex, "carry").mockResolvedValue(false);

    expect(await PgProjectSync.resolve("p1", "keep-as-new")).toBe(false);

    // Only the copy goes, so answering again does not hit its name
    expect(deleteWorkspace.mock.calls).toEqual([["mine (kept)"]]);
    expect(PgProjectSync.conflictFor("p1")?.kind).toBe("deleted-elsewhere");
  });

  it("does not keep an empty copy of a directory another tab removed", async () => {
    // Kept, it would be a project called "mine (kept)" with nothing in it,
    // and the original deleted after it -- the work gone, with a project
    // left standing that says it was kept
    refusing({ ok: false, status: 404, json: async () => ({}) });
    await signedIn();
    asWorkspace("p1", "mine");
    PgProjectSync.raise({ projectId: "p1", kind: "deleted-elsewhere" });
    storedFiles().delete("/mine/src/lib.rs");
    const importWorkspace = vi.spyOn(PgExplorer, "importWorkspace");
    const deleteWorkspace = vi.spyOn(PgExplorer, "deleteWorkspace");

    expect(await PgProjectSync.resolve("p1", "keep-as-new")).toBe(false);
    expect(importWorkspace).not.toHaveBeenCalled();
    expect(deleteWorkspace).not.toHaveBeenCalled();
    expect(PgProjectSync.conflictFor("p1")?.kind).toBe("deleted-elsewhere");
  });

  it("does not keep a workspace another tab renamed", async () => {
    // And then delete it under the name it no longer has, which may by now
    // be another project's
    refusing({ ok: false, status: 404, json: async () => ({}) });
    await signedIn();
    asWorkspace("p1", "mine");
    PgProjectSync.raise({ projectId: "p1", kind: "deleted-elsewhere" });
    storedFiles().set(
      PgWorkspace.WORKSPACES_CONFIG_PATH,
      JSON.stringify({ workspaces: [{ id: "p2", name: "mine" }] })
    );
    const importWorkspace = vi.spyOn(PgExplorer, "importWorkspace");
    const deleteWorkspace = vi.spyOn(PgExplorer, "deleteWorkspace");

    expect(await PgProjectSync.resolve("p1", "keep-as-new")).toBe(false);
    expect(importWorkspace).not.toHaveBeenCalled();
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });
});
