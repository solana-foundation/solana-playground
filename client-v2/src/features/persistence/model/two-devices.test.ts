import type { Mock } from "vitest";
import { PgChatStorage } from "./chat-storage";
import { clearFailures, getFailures } from "./diagnostics";
import { PgProjectSync } from "./project-sync";
import { sha256, snapshotOf, SYNCED_WORKSPACE_FILES } from "./snapshot";
import { PgSyncBase } from "./sync-base";
import { PgSyncClient } from "./sync-client";
import { PgSyncMark } from "./sync-mark";
import { PgThreadIndex } from "./thread-index";
import { reconcile, releaseLocalProjects } from "./project-restore";
import { PgSession } from "../../auth";
import { isUuid } from "../../../shared/lib/ids";
import { projectSync } from "../../../effects/project-sync/project-sync";
import { PgCommon } from "../../../utils/common";
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
 * One person, two browsers.
 *
 * The halves are unit-tested either side of the wire, and both were
 * individually fine while the feature did not work: nothing uploaded a project
 * that had not been typed in since signing in, what did upload named itself by
 * its id, and a single refused write left the project unable to sync for the
 * rest of the page's life. None of those shows up in a test of one side.
 *
 * The server here is a stand-in that keeps the `/api/projects` contract --
 * including its three write modes, because which one a client takes is most of
 * what this file is about. The real one is covered against a real database in
 * `src/features/persistence/model/projects.test.mjs`.
 */

interface StoredProject {
  id: string;
  name: string;
  kind: string;
  snapshot: unknown;
  updatedAt: string;
  deleted?: boolean;
}

const server = new Map<string, StoredProject>();

/** Monotonic, because two writes in the same millisecond would tie */
let clock = 0;
const tick = () => `2026-01-01T00:00:${String(++clock).padStart(2, "0")}.000Z`;

const fakeFetch = async (url: string, init?: RequestInit) => {
  if (url === "/api/sync") {
    return { ok: true, json: async () => ({ enabled: true, db: "ok" }) };
  }

  if (init?.method === "DELETE") {
    const id = new URL(url, "http://x").searchParams.get("id")!;
    const existing = server.get(id);
    if (existing) {
      existing.deleted = true;
      existing.snapshot = null;
    }
    return { ok: true, json: async () => ({ deleted: true }) };
  }

  if (init?.method === "PUT") {
    const body = JSON.parse(init.body as string);
    const existing = server.get(body.id);
    const live = existing && !existing.deleted ? existing : null;

    // A tombstone names itself, as the real endpoint does. Two literals
    // rather than one with a spread, so each answer's fields are in view.
    const refuse = () =>
      existing?.deleted
        ? {
            ok: false,
            status: 409,
            json: async () => ({
              conflict: true,
              updatedAt: null,
              reason: "deleted",
            }),
          }
        : {
            ok: false,
            status: 409,
            json: async () => ({
              conflict: true,
              updatedAt: live ? live.updatedAt : null,
            }),
          };

    if (body.changed && !body.baseUpdatedAt) return refuse();
    if (body.baseUpdatedAt) {
      // Compare-and-swap: the write lands only if the row still holds the
      // timestamp this client read
      if (!live || live.updatedAt !== body.baseUpdatedAt) return refuse();
    } else if (live && live.snapshot !== null) {
      // Create-only. A row with no snapshot is adoptable -- a chat turn
      // creates one before the project's own first upload.
      return refuse();
    } else if (
      existing?.deleted &&
      !(existing.kind === "tutorial" && body.kind === "tutorial")
    ) {
      // A tutorial's tombstone is the exception: its id is derived from its
      // name, so starting it again can only arrive here
      return refuse();
    }

    // The real endpoint's two shapes: a whole file set, or a patch on the
    // row the token names (which the swap above has just proved is `live`)
    const held =
      (live?.snapshot as { files: Record<string, string> } | null)?.files ?? {};
    const files: Record<string, string> = body.files
      ? { ...body.files }
      : { ...held, ...(body.changed ?? {}) };
    for (const path of body.removed ?? []) delete files[path];

    const stored: StoredProject = {
      id: body.id,
      name: body.name,
      kind: body.kind,
      snapshot: { files },
      updatedAt: tick(),
    };
    server.set(stored.id, stored);
    return { ok: true, json: async () => ({ updatedAt: stored.updatedAt }) };
  }

  const id = new URL(url, "http://x").searchParams.get("id");
  const live = [...server.values()].filter((p) => !p.deleted);
  if (id) {
    const project = server.get(id);
    return project && !project.deleted
      ? { ok: true, json: async () => ({ project }) }
      : { ok: false, status: 404, json: async () => ({}) };
  }
  return { ok: true, json: async () => ({ projects: live }) };
};

const storedFiles = () =>
  (PgFs as unknown as { __files: Map<string, string> }).__files;

const signedIn = () =>
  PgSession.refreshWith({ id: "u1", name: null, image: null, login: null });

/**
 * Point the module statics at one browser.
 *
 * Marks live in `PgFs`, which is shared across every `asDevice` call in a
 * test, so a test that means "a different browser" clears them explicitly.
 */
const asDevice = (
  workspaces: Array<{ id: string; name: string }>,
  content = "declare_id!();"
) => {
  const current = workspaces[0];
  // Read through the list, so a rename of the entry is followed
  vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockImplementation(
    () => workspaces[0]?.id
  );
  vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockImplementation(
    () => workspaces[0]?.name
  );
  vi.spyOn(PgExplorer, "allWorkspaceNames", "get")
    // Read through to the list rather than snapshotting it, so a test that
    // removes a workspace mid-way sees the explorer it would really have
    .mockImplementation(() => workspaces.map((w) => w.name));
  vi.spyOn(PgExplorer, "workspaceIdOf").mockImplementation(
    (name) => workspaces.find((w) => w.name === name)?.id as string
  );
  vi.spyOn(PgExplorer, "workspaceNameOf").mockImplementation(
    (id) => workspaces.find((w) => w.id === id)?.name as string
  );
  if (current) storedFiles().set(`/${current.name}/src/lib.rs`, content);
  // `reconcile` reloads the open workspace from disk before anything else,
  // to catch a neighbour tab's write this one never heard about. Read
  // through to the store rather than snapshotted once, so a test that
  // writes to it later (simulating this tab's own unsaved edit) is read as
  // the same edit in memory -- matching what autosave really does, and
  // keeping the reload a no-op rather than an unmocked `switchWorkspace`.
  vi.spyOn(PgExplorer, "files", "get").mockImplementation(() => {
    if (!workspaces[0]) return {};
    const prefix = `/${workspaces[0].name}/`;
    return Object.fromEntries(
      [...storedFiles()]
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, content]) => [path, { content }])
    );
  });
  return vi
    .spyOn(PgExplorer, "importWorkspace")
    .mockResolvedValue(undefined as never);
};

/** Everything a fresh browser starts without */
const asFreshDevice = (
  workspaces: Array<{ id: string; name: string }>,
  content?: string
) => {
  PgProjectSync.reset();
  PgSyncBase.reset();
  storedFiles().clear();
  vi.restoreAllMocks();
  return asDevice(workspaces, content);
};

const setUp = () => {
  server.clear();
  clock = 0;
  PgSession.reset();
  PgSyncClient.reset();
  PgProjectSync.reset();
  PgSyncBase.reset();
  storedFiles().clear();
  global.fetch = vi.fn(fakeFetch) as unknown as typeof fetch;
};

/**
 * A write from the *other* browser.
 *
 * Applied to the stand-in server directly rather than through
 * `PgProjectSync`: that would record a sync mark, and the mark is this
 * device's record of what it uploaded. Routing the other device's write
 * through it would hand this device an agreement it never made.
 */
const otherDeviceWrote = (id: string, content: string) => {
  const existing = server.get(id)!;
  server.set(id, {
    ...existing,
    snapshot: { files: { "src/lib.rs": content } },
    updatedAt: tick(),
  });
};

/** The other browser wrote these files, and only these */
const otherDeviceWroteFiles = (id: string, files: Record<string, string>) => {
  const existing = server.get(id)!;
  server.set(id, { ...existing, snapshot: { files }, updatedAt: tick() });
};

/** Replace what the store holds for a workspace with exactly these files */
const writeStored = (name: string, files: Record<string, string>) => {
  const stored = storedFiles();
  for (const path of [...stored.keys()]) {
    if (path.startsWith(`/${name}/`)) stored.delete(path);
  }
  for (const [path, content] of Object.entries(files)) {
    stored.set(`/${name}/${path}`, content);
  }
};

/**
 * This browser's current workspace now holds these files.
 *
 * In the store, which is what an upload reads: tabs share it, and only it.
 * Memory says the same, the way autosave leaves it.
 */
const localFilesAre = (name: string, files: Record<string, string>) => {
  writeStored(name, files);
  return vi
    .spyOn(PgExplorer, "getAllFiles")
    .mockReturnValue(
      Object.entries(files).map(([path, content]) => [
        `/${name}/${path}`,
        content,
      ])
    );
};

/**
 * The workspace writes a merge makes, captured instead of hitting the store.
 *
 * Re-opening behaves like the real explorer's: the files a replace wrote are
 * what the workspace holds in memory afterwards, and not before. That window
 * is where a stale copy used to escape from.
 */
const captureWrites = () => {
  const rewritten = new Map<string, Record<string, string>>();
  vi.spyOn(PgExplorer, "switchWorkspace").mockImplementation(
    async (name: string) => {
      // Memory re-read from what the replace wrote. The store is not
      // touched: whatever was folded in after the replace is already there.
      const files = rewritten.get(name);
      if (files) {
        vi.spyOn(PgExplorer, "getAllFiles").mockReturnValue(
          Object.entries(files).map(([path, content]) => [
            `/${name}/${path}`,
            content,
          ])
        );
      }
    }
  );
  return vi
    .spyOn(PgExplorer, "replaceWorkspaceFiles")
    .mockImplementation(async (name: string, files: Record<string, string>) => {
      rewritten.set(name, files);
      // The store has them at once, as with the real replace; memory only
      // once the workspace is re-opened
      writeStored(name, files);
    });
};

/** What the editor holds, per full path, standing in for Monaco's models */
let editor: { dispose: () => void } | null = null;
const editorHolds = (buffers: Record<string, string>) => {
  const held = new Map(Object.entries(buffers));
  editor = PgExplorer.registerEditorBuffers({
    read: (path) => held.get(path),
    write: (path, content) => void held.set(path, content),
    discard: (path) => void held.delete(path),
  });
  return held;
};

/** The other browser deleted it, so the row is tombstoned */
const otherDeviceDeleted = (id: string) => {
  const existing = server.get(id)!;
  server.set(id, { ...existing, deleted: true, snapshot: null });
};

const HELLO = { id: "tut:hello-anchor", name: "Hello Anchor" };

/** A divergent conflict on `paths`, carrying a file conflict for each */
const divergentOn = (projectId: string, paths: string[]) => ({
  projectId,
  kind: "divergent",
  paths,
  files: paths.map((path) => expect.objectContaining({ path })),
});

describe("a tutorial started on one browser, opened on another", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  it("arrives under the name the user knows it by", async () => {
    asDevice([HELLO]);
    await signedIn();
    expect(await PgProjectSync.pushCurrent()).toBe("ok");

    const importWorkspace = asFreshDevice([]);
    await signedIn();

    expect((await reconcile()).imported).toEqual(["Hello Anchor"]);
    expect(importWorkspace).toHaveBeenCalledWith("Hello Anchor", {
      id: "tut:hello-anchor",
      files: { "src/lib.rs": "declare_id!();" },
    });
  });

  it("asks nothing when the second browser's copy is already identical", async () => {
    // The id is derived from the name, so opening the tutorial by link on a
    // second browser mints the same id there. Same bytes, nothing to decide.
    asDevice([HELLO]);
    await signedIn();
    await PgProjectSync.pushCurrent();

    const importWorkspace = asFreshDevice([HELLO]);
    await signedIn();
    const result = await reconcile();

    expect(result.imported).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(importWorkspace).not.toHaveBeenCalled();
    // and having recorded the agreement, it does not push it back up
    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
  });

  it("asks when the second browser's copy has different work in it", async () => {
    asDevice([HELLO]);
    await signedIn();
    await PgProjectSync.pushCurrent();

    const replace = vi
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockResolvedValue(undefined as never);
    asFreshDevice([HELLO], "my own half-finished attempt");
    await signedIn();

    const result = await reconcile();

    expect(result.conflicts).toEqual([
      divergentOn("tut:hello-anchor", ["src/lib.rs"]),
    ]);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("work that never reached the server", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  /**
   * The sequence the old code lost an afternoon to: this device pushes, then
   * edits again while the push fails, while the other device writes.
   */
  const diverge = async () => {
    asDevice([HELLO]);
    await signedIn();
    await PgProjectSync.pushCurrent();

    otherDeviceWrote(HELLO.id, "the other device");

    // ...and this device has local work it never managed to upload
    storedFiles().set(`/${HELLO.name}/src/lib.rs`, "an afternoon of work");
  };

  it("is not overwritten by a reload", async () => {
    await diverge();
    const replace = vi
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockResolvedValue(undefined as never);

    const result = await reconcile();

    expect(replace).not.toHaveBeenCalled();
    expect(result.conflicts).toEqual([divergentOn(HELLO.id, ["src/lib.rs"])]);
  });

  it("stops being retried, instead of 409ing for the life of the page", async () => {
    await diverge();
    await reconcile();

    const before = (global.fetch as Mock).mock.calls.length;
    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
    expect((global.fetch as Mock).mock.calls.length).toBe(before);
  });

  it("uploads this device's copy when the user keeps it", async () => {
    await diverge();
    await reconcile();

    expect(await PgProjectSync.resolve(HELLO.id, "keep-local")).toBe(true);

    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "an afternoon of work" },
    });
    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
    // and the project syncs normally again afterwards
    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
  });

  it("takes the other device's copy when the user picks that", async () => {
    await diverge();
    await reconcile();
    const replace = vi
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockResolvedValue(undefined as never);
    vi.spyOn(PgExplorer, "switchWorkspace").mockResolvedValue(undefined);

    expect(await PgProjectSync.resolve(HELLO.id, "take-server")).toBe(true);

    expect(replace).toHaveBeenCalledWith(HELLO.name, {
      "src/lib.rs": "the other device",
    });
    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
  });
});

describe("both devices changed it", () => {
  beforeEach(() => {
    setUp();
    clearFailures();
  });
  afterEach(() => {
    editor?.dispose();
    editor = null;
    clearFailures();
    vi.restoreAllMocks();
  });

  const base = "a\nb\nc\nd\ne\n";

  /** In sync on `files`, then the other device writes `theirs` */
  const startFrom = async (
    files: Record<string, string>,
    theirs: Record<string, string>
  ) => {
    asDevice([HELLO]);
    localFilesAre(HELLO.name, files);
    await signedIn();
    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    otherDeviceWroteFiles(HELLO.id, theirs);
  };

  it("merges edits to different files without asking", async () => {
    await startFrom(
      { "src/lib.rs": "lib", "tests/t.rs": "test" },
      { "src/lib.rs": "lib", "tests/t.rs": "their test" }
    );
    localFilesAre(HELLO.name, { "src/lib.rs": "my lib", "tests/t.rs": "test" });
    const replace = captureWrites();

    expect(await PgProjectSync.pushCurrent()).toBe("ok");

    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "my lib", "tests/t.rs": "their test" },
    });
    expect(replace).toHaveBeenCalledWith(HELLO.name, {
      "src/lib.rs": "my lib",
      "tests/t.rs": "their test",
    });
    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
  });

  it("merges edits to different lines of one file without asking", async () => {
    await startFrom(
      { "src/lib.rs": base },
      { "src/lib.rs": "A\nb\nc\nd\ne\n" }
    );
    localFilesAre(HELLO.name, { "src/lib.rs": "a\nb\nc\nd\nE\n" });
    captureWrites();

    expect(await PgProjectSync.pushCurrent()).toBe("ok");

    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "A\nb\nc\nd\nE\n" },
    });
  });

  it("starts over from what it merged when another write overtakes its upload", async () => {
    await startFrom(
      { "src/lib.rs": base, "tests/t.rs": "test" },
      { "src/lib.rs": "A\nb\nc\nd\ne\n", "tests/t.rs": "test" }
    );
    localFilesAre(HELLO.name, { "src/lib.rs": base, "tests/t.rs": "my test" });
    const replace = captureWrites();
    // The first PUT is this device's own, refused because the other device
    // wrote; the second is the merge's, and the other device writes again
    // just before it arrives. The workspace in memory still holds the
    // pre-merge copy then, so a retry that re-read it would undo `A`.
    const online = global.fetch;
    let puts = 0;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT" && ++puts === 2) {
        otherDeviceWroteFiles(HELLO.id, {
          "src/lib.rs": "A\nb\nc\nd\ne\n",
          "tests/t.rs": "test",
          "src/new.rs": "new",
        });
      }
      return online(url, init);
    }) as unknown as typeof fetch;

    expect(await PgProjectSync.pushCurrent()).toBe("ok");

    const expected = {
      "src/lib.rs": "A\nb\nc\nd\ne\n",
      "tests/t.rs": "my test",
      "src/new.rs": "new",
    };
    expect(server.get(HELLO.id)!.snapshot).toEqual({ files: expected });
    expect(replace).toHaveBeenLastCalledWith(HELLO.name, expected);
    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
  });

  it("still merges after a reload, from the base it kept", async () => {
    await startFrom(
      { "src/lib.rs": base },
      { "src/lib.rs": "A\nb\nc\nd\ne\n" }
    );
    localFilesAre(HELLO.name, { "src/lib.rs": "a\nb\nc\nd\nE\n" });
    // The first attempt is refused offline-style: the base is captured before
    // the request, and then the page goes away
    const online = global.fetch;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") throw new Error("offline");
      return online(url, init);
    }) as unknown as typeof fetch;
    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
    global.fetch = online;

    PgProjectSync.reset();
    PgSyncBase.reset();
    await signedIn();
    captureWrites();

    const result = await reconcile();

    expect(result.conflicts).toEqual([]);
    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "A\nb\nc\nd\nE\n" },
    });
  });

  it("asks only about the file whose lines overlap, and merges the rest", async () => {
    await startFrom(
      { "src/lib.rs": base, "tests/t.rs": "test" },
      { "src/lib.rs": "a\ntheirs\nc\nd\ne\n", "tests/t.rs": "their test" }
    );
    localFilesAre(HELLO.name, {
      "src/lib.rs": "a\nmine\nc\nd\ne\n",
      "tests/t.rs": "test",
    });
    const replace = captureWrites();

    expect(await PgProjectSync.pushCurrent()).toBe("conflict");

    expect(PgProjectSync.conflictFor(HELLO.id)).toEqual(
      divergentOn(HELLO.id, ["src/lib.rs"])
    );
    // Only the line both changed is in question
    expect(PgProjectSync.conflictFor(HELLO.id)?.files).toEqual([
      expect.objectContaining({
        kind: "lines",
        chunks: [
          { kind: "settled", lines: ["a"] },
          { kind: "conflict", base: ["b"], ours: ["mine"], theirs: ["theirs"] },
          { kind: "settled", lines: ["c", "d", "e", ""] },
        ],
      }),
    ]);
    // Nothing is written until the user answers
    expect(replace).not.toHaveBeenCalled();

    expect(await PgProjectSync.resolve(HELLO.id, "keep-local")).toBe(true);

    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "a\nmine\nc\nd\ne\n", "tests/t.rs": "their test" },
    });
    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
  });

  it("takes the other device's side of the overlap, and keeps this device's merged work", async () => {
    await startFrom(
      { "src/lib.rs": base, "src/mine.rs": "x" },
      { "src/lib.rs": "a\ntheirs\nc\nd\ne\n", "src/mine.rs": "x" }
    );
    localFilesAre(HELLO.name, {
      "src/lib.rs": "a\nmine\nc\nd\ne\n",
      "src/mine.rs": "my change",
    });
    const replace = captureWrites();
    await PgProjectSync.pushCurrent();

    expect(await PgProjectSync.resolve(HELLO.id, "take-server")).toBe(true);

    expect(replace).toHaveBeenLastCalledWith(HELLO.name, {
      "src/lib.rs": "a\ntheirs\nc\nd\ne\n",
      "src/mine.rs": "my change",
    });
    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: {
        "src/lib.rs": "a\ntheirs\nc\nd\ne\n",
        "src/mine.rs": "my change",
      },
    });
  });

  it("asks again, writing nothing, when more has come to overlap since the question", async () => {
    await startFrom(
      { "src/lib.rs": base, "tests/t.rs": base },
      { "src/lib.rs": "a\ntheirs\nc\nd\ne\n", "tests/t.rs": base }
    );
    localFilesAre(HELLO.name, {
      "src/lib.rs": "a\nmine\nc\nd\ne\n",
      "tests/t.rs": "a\nb\nc\nmine\ne\n",
    });
    const replace = captureWrites();
    expect(await PgProjectSync.pushCurrent()).toBe("conflict");
    expect(PgProjectSync.conflictFor(HELLO.id)?.paths).toEqual(["src/lib.rs"]);

    // While the banner is up, the other device edits the same line of the
    // file this one had merged cleanly
    const theirs = {
      "src/lib.rs": "a\ntheirs\nc\nd\ne\n",
      "tests/t.rs": "a\nb\nc\ntheirs\ne\n",
    };
    otherDeviceWroteFiles(HELLO.id, theirs);

    // The user was asked about `src/lib.rs` only, so "keep mine" does not
    // cover `tests/t.rs`
    expect(await PgProjectSync.resolve(HELLO.id, "keep-local")).toBe(false);

    expect(PgProjectSync.conflictFor(HELLO.id)).toEqual(
      divergentOn(HELLO.id, ["src/lib.rs", "tests/t.rs"])
    );
    expect(replace).not.toHaveBeenCalled();
    expect(server.get(HELLO.id)!.snapshot).toEqual({ files: theirs });
  });

  it("uploads what the user resolved line by line, and the other device takes it without asking", async () => {
    const theirs = "a\ntheirs\nc\nd\ne\n";
    await startFrom({ "src/lib.rs": base }, { "src/lib.rs": theirs });
    // What the other device last agreed with the account: its own write
    const theirsAt = server.get(HELLO.id)!.updatedAt;
    localFilesAre(HELLO.name, { "src/lib.rs": "a\nmine\nc\nd\ne\n" });
    captureWrites();
    expect(await PgProjectSync.pushCurrent()).toBe("conflict");

    // Hunk by hunk, as the view does it: every settled line, and both sides
    // of each conflict, this device's first
    const [file] = PgProjectSync.conflictFor(HELLO.id)!.files!;
    if (file.kind !== "lines") throw new Error("expected a line conflict");
    const content = file.chunks
      .flatMap((chunk) =>
        chunk.kind === "settled" ? chunk.lines : chunk.ours.concat(chunk.theirs)
      )
      .join("\n");
    expect(content).toBe("a\nmine\ntheirs\nc\nd\ne\n");

    expect(
      await PgProjectSync.resolve(HELLO.id, {
        kind: "resolved",
        files: {
          "src/lib.rs": {
            content,
            localHash: file.localHash,
            serverHash: file.serverHash,
          },
        },
      })
    ).toBe(true);
    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": content },
    });

    // The other device, still holding its own copy and its own agreement
    asFreshDevice([HELLO], theirs);
    await PgSyncMark.write(HELLO.id, {
      files: { "src/lib.rs": await sha256(theirs) },
      name: HELLO.name,
      updatedAt: theirsAt,
      dirty: false,
    });
    const replace = captureWrites();
    const uploads = () =>
      (global.fetch as Mock).mock.calls.filter(
        ([, init]) => init?.method === "PUT"
      ).length;
    const before = uploads();

    const result = await reconcile();

    expect(result.conflicts).toEqual([]);
    expect(result.replaced).toEqual([HELLO.name]);
    expect(replace).toHaveBeenCalledWith(HELLO.name, { "src/lib.rs": content });
    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
    expect(uploads()).toBe(before);
    expect(await PgProjectSync.pushCurrent()).toBe("skipped");
  });

  // Separate files, so the merge needs no base content: these call the merge
  // directly, without the refused push that would have captured one
  const before = { "src/lib.rs": "lib", "src/mine.rs": "x" };
  const theirs = { "src/lib.rs": "their lib", "src/mine.rs": "x" };
  const mine = { "src/lib.rs": "lib", "src/mine.rs": "my change" };
  const both = { "src/lib.rs": "their lib", "src/mine.rs": "my change" };

  it("does not upload a copy read before a merge it was parked behind", async () => {
    await startFrom(before, theirs);
    localFilesAre(HELLO.name, mine);
    captureWrites();

    // The editor's debounce fires while something holds the gate -- a
    // reconcile, say -- and then a merge runs before the gate opens
    PgProjectSync.holdPushes();
    const parked = PgProjectSync.pushCurrent();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await PgProjectSync.mergeWithServer(HELLO.id, HELLO.name)).toBe(
      "merged"
    );
    PgProjectSync.releasePushes();
    await parked;

    // Both sides' changes. The parked push, had it sent what it read before
    // waiting, would have patched `lib` back over `their lib` and passed the
    // swap.
    expect(server.get(HELLO.id)!.snapshot).toEqual({ files: both });
  });

  it("drops a snapshot read before a merge rewrote the files", async () => {
    await startFrom(before, theirs);
    localFilesAre(HELLO.name, mine);
    captureWrites();

    const generation = PgProjectSync.generationOf(HELLO.id);
    expect(await PgProjectSync.mergeWithServer(HELLO.id, HELLO.name)).toBe(
      "merged"
    );

    expect(
      await PgProjectSync.push(HELLO.id, { files: mine }, HELLO.name, {
        generation,
      })
    ).toBe("skipped");
    expect(server.get(HELLO.id)!.snapshot).toEqual({ files: both });
  });

  it("brings the open file's editor buffer up to the merged copy", async () => {
    // Monaco reuses a file's model on re-open instead of taking its new
    // content, and autosaves it back half a second after a keystroke. The
    // buffer is the copy that has to change, or the merge is undone by typing.
    await startFrom(
      { "src/lib.rs": base },
      { "src/lib.rs": "A\nb\nc\nd\ne\n" }
    );
    localFilesAre(HELLO.name, { "src/lib.rs": "a\nb\nc\nd\nE\n" });
    captureWrites();
    const buffers = editorHolds({
      [`/${HELLO.name}/src/lib.rs`]: "a\nb\nc\nd\nE\n",
    });

    expect(await PgProjectSync.pushCurrent()).toBe("ok");

    expect(buffers.get(`/${HELLO.name}/src/lib.rs`)).toBe("A\nb\nc\nd\nE\n");
  });

  it("folds in what was typed while the merge ran", async () => {
    await startFrom(
      { "src/lib.rs": base },
      { "src/lib.rs": "A\nb\nc\nd\ne\n" }
    );
    localFilesAre(HELLO.name, { "src/lib.rs": "a\nb\nc\nd\nE\n" });
    captureWrites();
    // Typed, and not yet autosaved: the buffer is ahead of what the merge read
    const buffers = editorHolds({
      [`/${HELLO.name}/src/lib.rs`]: "a\nb\nC\nd\nE\n",
    });

    expect(await PgProjectSync.pushCurrent()).toBe("ok");

    expect(buffers.get(`/${HELLO.name}/src/lib.rs`)).toBe("A\nb\nC\nd\nE\n");
    // and on disk, so the re-read and the next upload see it too
    expect(storedFiles().get(`/${HELLO.name}/src/lib.rs`)).toBe(
      "A\nb\nC\nd\nE\n"
    );
    expect(getFailures()).toEqual([]);
  });

  it("keeps the merged copy, and says so, when what was typed overlaps it", async () => {
    await startFrom(
      { "src/lib.rs": base },
      { "src/lib.rs": "A\nb\nc\nd\ne\n" }
    );
    localFilesAre(HELLO.name, { "src/lib.rs": "a\nb\nc\nd\nE\n" });
    captureWrites();
    const buffers = editorHolds({
      [`/${HELLO.name}/src/lib.rs`]: "typed\nb\nc\nd\nE\n",
    });

    expect(await PgProjectSync.pushCurrent()).toBe("ok");

    expect(buffers.get(`/${HELLO.name}/src/lib.rs`)).toBe("A\nb\nc\nd\nE\n");
    expect(getFailures().map((f) => f.what)).toEqual([
      expect.stringContaining("src/lib.rs"),
    ]);
  });

  it("brings the editor buffer up to a copy taken from the other device", async () => {
    // `adopt` shares the replace, and so shared the stale model
    await startFrom(
      { "src/lib.rs": base },
      { "src/lib.rs": "A\nb\nc\nd\ne\n" }
    );
    captureWrites();
    const buffers = editorHolds({ [`/${HELLO.name}/src/lib.rs`]: base });

    expect((await reconcile()).replaced).toEqual([HELLO.name]);

    expect(buffers.get(`/${HELLO.name}/src/lib.rs`)).toBe("A\nb\nc\nd\ne\n");
  });

  it("does not take the other device's copy over what was typed and saved while it was being fetched", async () => {
    // Reconcile found the copy clean and adopted. The user typed during the
    // adoption's round trip and autosave stored it, so a copy of the local
    // files read after the fetch already held the typing -- and was taken as
    // what the editor agreed with, so nothing was folded and the typing went.
    await startFrom(
      { "src/lib.rs": base },
      { "src/lib.rs": "A\nb\nc\nd\ne\n" }
    );
    const replace = captureWrites();
    const path = `/${HELLO.name}/src/lib.rs`;
    const buffers = editorHolds({ [path]: base });
    const typed = "a\nb\nc\nd\nE\n";

    const online = global.fetch;
    let reads = 0;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const response = await online(url, init);
      if (!init?.method && url.includes("id=") && ++reads === 1) {
        buffers.set(path, typed);
        localFilesAre(HELLO.name, { "src/lib.rs": typed });
      }
      return response;
    }) as unknown as typeof fetch;

    const result = await reconcile();

    expect(result.replaced).toEqual([]);
    expect(replace).not.toHaveBeenCalled();
    expect(buffers.get(path)).toBe(typed);

    // Left as work owed, so the next push merges it with the other device's
    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "A\nb\nc\nd\nE\n" },
    });
  });

  it("leaves the project marked as owing work when a merge folded in typing the server has not got", async () => {
    // The merge's upload carries the merged copy; what was typed while it ran
    // is folded in afterwards, and only on this device. A mark that says
    // nothing is owed makes reconcile's cheap path skip the project, so the
    // typing stayed here until the next edit.
    await startFrom(
      { "src/lib.rs": base },
      { "src/lib.rs": "A\nb\nc\nd\ne\n" }
    );
    localFilesAre(HELLO.name, { "src/lib.rs": "a\nb\nc\nd\nE\n" });
    captureWrites();
    editorHolds({ [`/${HELLO.name}/src/lib.rs`]: "a\nb\nC\nd\nE\n" });

    expect(await PgProjectSync.pushCurrent()).toBe("ok");

    expect(storedFiles().get(`/${HELLO.name}/src/lib.rs`)).toBe(
      "A\nb\nC\nd\nE\n"
    );
    expect((await PgSyncMark.read(HELLO.id))?.dirty).toBe(true);
  });

  it("merges an edit no push has sent yet, when a reconcile gets there first", async () => {
    // Autosaved and flagged, with the debounce still pending, when a
    // reconcile finds the other device has moved. Only a push kept a base,
    // so the reconcile's merge had none and asked about the whole file.
    await startFrom(
      { "src/lib.rs": base },
      { "src/lib.rs": "A\nb\nc\nd\ne\n" }
    );
    localFilesAre(HELLO.name, { "src/lib.rs": "a\nb\nc\nd\nE\n" });
    await PgSyncMark.markDirty(HELLO.id);
    captureWrites();

    const result = await reconcile();

    expect(result.conflicts).toEqual([]);
    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "A\nb\nc\nd\nE\n" },
    });
  });

  it("leaves a project whose merge is still running to the next pass", async () => {
    await startFrom(
      { "src/lib.rs": base },
      { "src/lib.rs": "A\nb\nc\nd\ne\n" }
    );
    localFilesAre(HELLO.name, { "src/lib.rs": "a\nb\nc\nd\nE\n" });
    const replace = captureWrites();
    vi.spyOn(PgProjectSync, "isMerging").mockReturnValue(true);

    const result = await reconcile();

    expect(result.conflicts).toEqual([]);
    expect(result.replaced).toEqual([]);
    expect(replace).not.toHaveBeenCalled();
    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "A\nb\nc\nd\ne\n" },
    });
  });
});

describe("two rewrites of one project at once", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const before = { "src/lib.rs": "lib", "src/mine.rs": "x" };
  const theirs = { "src/lib.rs": "their lib", "src/mine.rs": "x" };
  const mine = { "src/lib.rs": "lib", "src/mine.rs": "my change" };
  const both = { "src/lib.rs": "their lib", "src/mine.rs": "my change" };

  /** Let everything that can run without outside help run */
  const settle = async () => {
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  /**
   * Replace and re-open like the real explorer, except that the re-open
   * waits for `reopen()`: memory still holds the pre-merge copy until then,
   * which is the window a second merge used to read it in.
   */
  const reopenOnCue = () => {
    let reopen!: () => void;
    const cue = new Promise<void>((resolve) => (reopen = resolve));
    let rewritten: Record<string, string> | null = null;
    const replace = vi
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockImplementation(
        async (_name: string, files: Record<string, string>) => {
          rewritten = files;
        }
      );
    const switched = vi
      .spyOn(PgExplorer, "switchWorkspace")
      .mockImplementation(async (name: string) => {
        await cue;
        if (rewritten) localFilesAre(name, rewritten);
      });
    return { reopen, replace, switched };
  };

  const startFrom = async () => {
    asDevice([HELLO]);
    localFilesAre(HELLO.name, before);
    await signedIn();
    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    otherDeviceWroteFiles(HELLO.id, theirs);
    localFilesAre(HELLO.name, mine);
  };

  it("does not let a second merge revert the lines the first merged in", async () => {
    // A debounced PUT refused while reconcile is merging reaches the merge
    // from `push`. Run alongside, it read the pre-merge copy from memory and
    // the first merge's agreement from the mark, and uploaded the pre-merge
    // copy as if this device had reverted the other's lines.
    await startFrom();
    const { reopen, switched } = reopenOnCue();

    const first = PgProjectSync.mergeWithServer(HELLO.id, HELLO.name);
    await settle();
    expect(switched).toHaveBeenCalledTimes(1);

    const second = PgProjectSync.mergeWithServer(HELLO.id, HELLO.name);
    await settle();
    reopen();

    expect(await first).toBe("merged");
    expect(await second).toBe("merged");
    expect(server.get(HELLO.id)!.snapshot).toEqual({ files: both });
  });

  it("answers the banner after a merge already running, with the user's own answer", async () => {
    const overlapping = {
      "src/lib.rs": "a\nmine\nc\n",
      "tests/t.rs": "test",
    };
    asDevice([HELLO]);
    localFilesAre(HELLO.name, {
      "src/lib.rs": "a\nb\nc\n",
      "tests/t.rs": "test",
    });
    await signedIn();
    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    otherDeviceWroteFiles(HELLO.id, {
      "src/lib.rs": "a\ntheirs\nc\n",
      "tests/t.rs": "their test",
    });
    localFilesAre(HELLO.name, overlapping);
    captureWrites();
    expect(await PgProjectSync.pushCurrent()).toBe("conflict");

    // A reconcile's merge, held at its read of the server
    const online = global.fetch;
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    let reads = 0;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method && url.includes("id=") && ++reads === 1) await held;
      return online(url, init);
    }) as unknown as typeof fetch;

    const running = PgProjectSync.mergeWithServer(HELLO.id, HELLO.name);
    await settle();
    const resolved = PgProjectSync.resolve(HELLO.id, "keep-local");
    await settle();
    // Waiting its turn: it has not read the server yet
    expect(reads).toBe(1);

    answer();
    expect(await running).toBe("conflict");
    expect(await resolved).toBe(true);
    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "a\nmine\nc\n", "tests/t.rs": "their test" },
    });
    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
  });

  it("does not take the server's copy over work a merge it waited behind left unsent", async () => {
    // Reconcile decided the copy was clean, and then queued behind a merge
    // whose upload went nowhere. The merged work is only on this device.
    await startFrom();
    const { reopen, replace } = reopenOnCue();
    const online = global.fetch;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") throw new Error("offline");
      return online(url, init);
    }) as unknown as typeof fetch;

    const merging = PgProjectSync.mergeWithServer(HELLO.id, HELLO.name);
    await settle();
    const adopting = PgProjectSync.adopt(HELLO.id);
    await settle();
    reopen();

    expect(await merging).toBe("merged");
    expect(await adopting).toBeNull();
    expect(replace).toHaveBeenLastCalledWith(HELLO.name, both);
  });
});

describe("deleting on one device", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  it("removes it from this one too, and does not resurrect it", async () => {
    // This browser is in sync with the account, and then the project is
    // deleted elsewhere. The tombstone is what tells the difference between
    // that and a project this device simply never uploaded.
    asDevice([HELLO]);
    await signedIn();
    await PgProjectSync.pushCurrent();

    otherDeviceDeleted(HELLO.id);

    const deleteWorkspace = vi
      .spyOn(PgExplorer, "deleteWorkspace")
      .mockResolvedValue(undefined as never);
    const importWorkspace = vi
      .spyOn(PgExplorer, "importWorkspace")
      .mockResolvedValue(undefined as never);

    const result = await reconcile();

    expect(importWorkspace).not.toHaveBeenCalled();
    expect(deleteWorkspace).toHaveBeenCalledWith(HELLO.name);
    expect(result.removed).toEqual([HELLO.name]);
  });

  it("asks this one before removing work it never uploaded", async () => {
    asDevice([HELLO]);
    await signedIn();
    await PgProjectSync.pushCurrent();

    otherDeviceDeleted(HELLO.id);
    // ...and only then does this device get work that never uploaded
    storedFiles().set(`/${HELLO.name}/src/lib.rs`, "unsaved");
    const deleteWorkspace = vi
      .spyOn(PgExplorer, "deleteWorkspace")
      .mockResolvedValue(undefined as never);

    const result = await reconcile();

    expect(deleteWorkspace).not.toHaveBeenCalled();
    expect(result.conflicts).toEqual([
      { projectId: HELLO.id, kind: "deleted-elsewhere" },
    ]);
  });

  it("carries the conversation into the project kept as new", async () => {
    // The chat is part of the work being kept. It moves under a fresh thread
    // id -- the old one is tombstoned with the project -- and the deleted id
    // keeps no entry, so a tutorial started again under it starts clean.
    // Through the real index. The delete is stubbed and fires no event, so
    // the order against it is pinned in `project-sync.test.ts`, not here.
    asDevice([HELLO]);
    await signedIn();
    await PgProjectSync.pushCurrent();
    const oldThread = await PgThreadIndex.ensure(HELLO.id);
    await PgChatStorage.write(oldThread, [
      {
        kind: "user",
        id: "33333333-0000-4000-8000-000000000001",
        createdAt: new Date(1000).toISOString(),
        text: "kept with the code",
      },
    ]);

    otherDeviceDeleted(HELLO.id);
    storedFiles().set(`/${HELLO.name}/src/lib.rs`, "unsaved");
    storedFiles().set(
      PgWorkspace.WORKSPACES_CONFIG_PATH,
      JSON.stringify({ workspaces: [HELLO] })
    );
    let keptId: string | null = null;
    vi.spyOn(PgExplorer, "importWorkspace").mockImplementation(
      async (_name: string, opts: { id: string }) => {
        keptId = opts.id;
      }
    );
    vi.spyOn(PgExplorer, "deleteWorkspace").mockResolvedValue(
      undefined as never
    );
    vi.spyOn(PgExplorer, "switchWorkspace").mockResolvedValue(undefined);
    await reconcile();

    expect(await PgProjectSync.resolve(HELLO.id, "keep-as-new")).toBe(true);

    expect(keptId).not.toBeNull();
    const carried = await PgThreadIndex.get(keptId!);
    expect(carried).not.toBeNull();
    expect(carried).not.toBe(oldThread);
    expect(await PgChatStorage.read(carried!)).toMatchObject([
      { text: "kept with the code" },
    ]);
    expect(await PgThreadIndex.get(HELLO.id)).toBeNull();
  });

  it("says it was deleted when an upload gets there first", async () => {
    // A pending edit uploads before any reconcile has seen the delete. The
    // refusal was indistinguishable from a newer version, so the user was
    // asked "keep this or take the other?" about a project with no other.
    asDevice([HELLO]);
    await signedIn();
    await PgProjectSync.pushCurrent();

    otherDeviceDeleted(HELLO.id);
    storedFiles().set(`/${HELLO.name}/src/lib.rs`, "unsaved");

    expect(await PgProjectSync.pushCurrent()).toBe("conflict");
    expect(PgProjectSync.conflictFor(HELLO.id)).toEqual({
      projectId: HELLO.id,
      kind: "deleted-elsewhere",
    });
    expect(server.get(HELLO.id)!.deleted).toBe(true);
  });
});

describe("a tutorial deleted and started again", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  it("syncs the new run instead of calling it a conflict", async () => {
    // Its id is derived from its name, so the restart reuses the tombstoned
    // id. Every upload of the new run was refused, and the banner offered a
    // version that did not exist.
    const workspaces = [HELLO];
    asDevice(workspaces);
    await signedIn();
    await PgProjectSync.pushCurrent();

    vi.spyOn(PgExplorer, "deleteWorkspace").mockImplementation(async () => {
      workspaces.splice(0, 1);
      // Saved before the event, as the real delete does: the effect settles
      // a delete against the store's list
      storedFiles().set(
        PgWorkspace.WORKSPACES_CONFIG_PATH,
        JSON.stringify({ workspaces })
      );
      PgCommon.createAndDispatchCustomEvent(
        PgExplorer.events.ON_DID_DELETE_WORKSPACE
      );
    });
    const effect = projectSync();
    try {
      await PgExplorer.deleteWorkspace(HELLO.name);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      effect.dispose();
    }
    expect(server.get(HELLO.id)!.deleted).toBe(true);

    vi.restoreAllMocks();
    asDevice([HELLO], "a fresh start");
    // Started again, so the store lists it again
    storedFiles().set(
      PgWorkspace.WORKSPACES_CONFIG_PATH,
      JSON.stringify({ workspaces: [HELLO] })
    );

    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
    expect(server.get(HELLO.id)).toMatchObject({
      snapshot: { files: { "src/lib.rs": "a fresh start" } },
    });
    expect(server.get(HELLO.id)!.deleted).toBeFalsy();
  });
});

describe("a device upgraded from whole-snapshot marks", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  /**
   * A mark as the previous version wrote it: one hash of the user's files,
   * sorted by path and serialised as pairs, and nothing per file. Computed
   * here from that description rather than by the code under test, so the
   * format is pinned.
   */
  const legacyMark = async (
    files: Record<string, string>,
    updatedAt: string
  ) => {
    const pairs = Object.keys(files)
      .filter((path) => !SYNCED_WORKSPACE_FILES.includes(path))
      .sort()
      .map((path) => [path, files[path]]);
    storedFiles().set(
      `/.config/sync/u1/${encodeURIComponent(HELLO.id)}.json`,
      JSON.stringify({
        hash: "whole snapshot",
        contentHash: await sha256(JSON.stringify(pairs)),
        name: HELLO.name,
        updatedAt,
        dirty: false,
      })
    );
  };

  const serverHolds = (files: Record<string, string>) => {
    const updatedAt = tick();
    server.set(HELLO.id, {
      id: HELLO.id,
      name: HELLO.name,
      kind: "tutorial",
      snapshot: { files },
      updatedAt,
    });
    return updatedAt;
  };

  const puts = () =>
    (global.fetch as Mock).mock.calls.filter(
      ([, init]) => init?.method === "PUT"
    );

  const PROGRAM_INFO = ".workspace/program-info.json";
  const ACCOUNT_INFO = '{"kp":"the account\'s"}';
  const DEVICE_INFO = '{"kp":"this device\'s"}';
  const programInfoPath = `/${HELLO.name}/${PROGRAM_INFO}`;
  const localProgramInfo = () => storedFiles().get(programInfoPath);
  const keypairOf = (content: string | undefined) =>
    content === undefined ? undefined : JSON.parse(content).kp;
  const serverFiles = () =>
    (server.get(HELLO.id)!.snapshot as { files: Record<string, string> }).files;

  /**
   * Replaces that land where the real explorer's do: every file in the
   * store, which is what a snapshot reads, and the user files in the
   * explorer's memory.
   */
  const writesLand = () => {
    vi.spyOn(PgExplorer, "switchWorkspace").mockResolvedValue(undefined);
    return vi
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockImplementation(
        async (name: string, files: Record<string, string>) => {
          // All of it in the store, which is what a snapshot reads; only the
          // user files in memory, as the explorer keeps them
          writeStored(name, files);
          vi.spyOn(PgExplorer, "getAllFiles").mockReturnValue(
            Object.entries(files)
              .filter(([path]) => !SYNCED_WORKSPACE_FILES.includes(path))
              .map(([path, content]) => [`/${name}/${path}`, content])
          );
        }
      );
  };

  it("takes the account's keypair when this copy is what it last agreed", async () => {
    // A legacy hash never covered the generated files, so a mark rebuilt from
    // this device's copy recorded this device's keypair as the agreement --
    // and the next build uploaded it over the account's
    const account = { "src/lib.rs": "same", [PROGRAM_INFO]: ACCOUNT_INFO };
    const agreedAt = serverHolds(account);
    await legacyMark(account, agreedAt);
    asDevice([HELLO], "same");
    storedFiles().set(programInfoPath, DEVICE_INFO);
    writesLand();
    await signedIn();

    const result = await reconcile();

    expect(result.conflicts).toEqual([]);
    expect(localProgramInfo()).toBe(ACCOUNT_INFO);
    expect((await PgSyncMark.read(HELLO.id))?.files[PROGRAM_INFO]).toBe(
      await sha256(ACCOUNT_INFO)
    );
    expect(puts()).toEqual([]);
    expect(keypairOf(serverFiles()[PROGRAM_INFO])).toBe("the account's");
  });

  it("does not hand the account this device's keypair on the next build", async () => {
    const account = { "src/lib.rs": "same", [PROGRAM_INFO]: ACCOUNT_INFO };
    const agreedAt = serverHolds(account);
    await legacyMark(account, agreedAt);
    asDevice([HELLO], "same");
    storedFiles().set(programInfoPath, DEVICE_INFO);
    writesLand();
    await signedIn();
    await reconcile();

    // A build rewrites the file in place, keeping whatever keypair it holds
    storedFiles().set(
      programInfoPath,
      JSON.stringify({ ...JSON.parse(localProgramInfo()!), idl: "built" })
    );
    await PgProjectSync.pushCurrent();

    expect(keypairOf(serverFiles()[PROGRAM_INFO])).toBe("the account's");
  });

  it("leaves the old mark alone when the copy stops being clean before it is taken", async () => {
    // Typing that lands while the account's copy is being fetched is on this
    // device alone. The adoption declines, and the mark must not be rebuilt
    // from this device's generated files in its place -- the next pass merges
    // it against nothing, where the account's keypair wins
    const account = { "src/lib.rs": "same", [PROGRAM_INFO]: ACCOUNT_INFO };
    const agreedAt = serverHolds(account);
    await legacyMark(account, agreedAt);
    asDevice([HELLO], "same");
    storedFiles().set(programInfoPath, DEVICE_INFO);
    const replace = writesLand();
    const realFetch = PgProjectSync.fetch;
    vi.spyOn(PgProjectSync, "fetch").mockImplementationOnce(
      async (projectId: string) => {
        localFilesAre(HELLO.name, { "src/lib.rs": "typed meanwhile" });
        return await realFetch.call(PgProjectSync, projectId);
      }
    );
    await signedIn();

    const first = await reconcile();

    expect(first.conflicts).toEqual([]);
    expect(replace).not.toHaveBeenCalled();
    expect(puts()).toEqual([]);
    expect(await PgSyncMark.inspect(HELLO.id)).toMatchObject({ legacy: true });

    const second = await reconcile();

    expect(second.conflicts).toEqual([divergentOn(HELLO.id, ["src/lib.rs"])]);
    expect(puts()).toEqual([]);
    expect(await PgProjectSync.resolve(HELLO.id, "keep-local")).toBe(true);
    expect(serverFiles()).toEqual({
      "src/lib.rs": "typed meanwhile",
      [PROGRAM_INFO]: ACCOUNT_INFO,
    });
  });

  it("merges against nothing when this copy is not what it last agreed, and keeps the account's keypair", async () => {
    const agreedAt = serverHolds({
      "src/lib.rs": "old",
      [PROGRAM_INFO]: ACCOUNT_INFO,
    });
    await legacyMark({ "src/lib.rs": "old" }, agreedAt);
    otherDeviceWroteFiles(HELLO.id, {
      "src/lib.rs": "theirs",
      [PROGRAM_INFO]: ACCOUNT_INFO,
    });
    asDevice([HELLO], "mine");
    storedFiles().set(programInfoPath, DEVICE_INFO);
    const replace = writesLand();
    await signedIn();

    const result = await reconcile();

    expect(result.conflicts).toEqual([divergentOn(HELLO.id, ["src/lib.rs"])]);
    expect(replace).not.toHaveBeenCalled();
    expect(puts()).toEqual([]);

    expect(await PgProjectSync.resolve(HELLO.id, "keep-local")).toBe(true);
    expect(serverFiles()).toEqual({
      "src/lib.rs": "mine",
      [PROGRAM_INFO]: ACCOUNT_INFO,
    });
    expect(localProgramInfo()).toBe(ACCOUNT_INFO);
  });

  it("takes the account's copy without asking when this one is what it last agreed", async () => {
    // Merged against an empty base, every line the other device changed read
    // as both sides adding different content, and a device that had done
    // nothing was asked -- where "Keep this version" reverted the other one
    const agreedAt = serverHolds({ "src/lib.rs": "a\nb\nc\n" });
    await legacyMark({ "src/lib.rs": "a\nb\nc\n" }, agreedAt);
    otherDeviceWroteFiles(HELLO.id, { "src/lib.rs": "a\ntheirs\nc\n" });
    asDevice([HELLO], "a\nb\nc\n");
    const replace = captureWrites();
    await signedIn();

    const result = await reconcile();

    expect(result.conflicts).toEqual([]);
    expect(result.replaced).toEqual([HELLO.name]);
    expect(replace).toHaveBeenCalledWith(HELLO.name, {
      "src/lib.rs": "a\ntheirs\nc\n",
    });
    expect(puts()).toEqual([]);
    // Rewritten in the current shape, from the copy it adopted
    expect((await PgSyncMark.read(HELLO.id))?.updatedAt).toBe(
      server.get(HELLO.id)!.updatedAt
    );
  });

  it("settles identical copies silently, and writes a mark it can use", async () => {
    // Taken from the account even so: an old mark cannot say whether the
    // generated files agree, and the account's copy is the one that is known
    // to be the agreement
    const account = { "src/lib.rs": "same", [PROGRAM_INFO]: ACCOUNT_INFO };
    const agreedAt = serverHolds(account);
    await legacyMark(account, agreedAt);
    asDevice([HELLO], "same");
    storedFiles().set(programInfoPath, ACCOUNT_INFO);
    const replace = writesLand();
    await signedIn();

    const result = await reconcile();

    expect(result.conflicts).toEqual([]);
    expect(replace).toHaveBeenCalledWith(HELLO.name, account);
    expect(puts()).toEqual([]);
    expect(await PgSyncMark.read(HELLO.id)).toEqual({
      files: {
        "src/lib.rs": await sha256("same"),
        [PROGRAM_INFO]: await sha256(ACCOUNT_INFO),
      },
      name: HELLO.name,
      updatedAt: agreedAt,
      dirty: false,
    });
  });

  it("asks about a delete elsewhere over unsent work, and keeps the question answerable", async () => {
    // Read as no mark at all, the project was also "never synced", so a
    // create-only upload went out, met the tombstone, and replaced this
    // question with a version question neither of whose answers can work
    const agreedAt = serverHolds({ "src/lib.rs": "old" });
    await legacyMark({ "src/lib.rs": "old" }, agreedAt);
    otherDeviceDeleted(HELLO.id);
    asDevice([HELLO], "unsent work");
    const deleteWorkspace = vi
      .spyOn(PgExplorer, "deleteWorkspace")
      .mockResolvedValue(undefined as never);
    vi.spyOn(PgExplorer, "switchWorkspace").mockResolvedValue(undefined);
    await signedIn();

    const result = await reconcile();

    expect(result.conflicts).toEqual([
      { projectId: HELLO.id, kind: "deleted-elsewhere" },
    ]);
    expect(PgProjectSync.conflictFor(HELLO.id)).toEqual({
      projectId: HELLO.id,
      kind: "deleted-elsewhere",
    });
    expect(puts()).toEqual([]);
    expect(deleteWorkspace).not.toHaveBeenCalled();

    const importWorkspace = vi.spyOn(PgExplorer, "importWorkspace");
    expect(await PgProjectSync.resolve(HELLO.id, "keep-as-new")).toBe(true);
    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();

    // Under a fresh id: the old one is tombstoned, and every push under it
    // would be refused. Imported before the original goes.
    const [name, { id }] = importWorkspace.mock.calls[0] as [
      string,
      { id: string }
    ];
    expect(name).toBe(`${HELLO.name} (kept)`);
    expect(isUuid(id)).toBe(true);
    expect(id).not.toBe(HELLO.id);
    expect(deleteWorkspace).toHaveBeenCalledWith(HELLO.name);
    expect(importWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      deleteWorkspace.mock.invocationCallOrder[0]
    );
  });

  it("finishes a delete elsewhere when this copy is what it last agreed", async () => {
    const agreedAt = serverHolds({ "src/lib.rs": "old" });
    await legacyMark({ "src/lib.rs": "old" }, agreedAt);
    otherDeviceDeleted(HELLO.id);
    const workspaces = [HELLO];
    asDevice(workspaces, "old");
    // Gone from the explorer as the real delete leaves it, so nothing later in
    // the pass reads it as a project the account has never seen
    const deleteWorkspace = vi
      .spyOn(PgExplorer, "deleteWorkspace")
      .mockImplementation(async () => void workspaces.pop());
    await signedIn();

    const result = await reconcile();

    expect(result.conflicts).toEqual([]);
    expect(result.removed).toEqual([HELLO.name]);
    expect(deleteWorkspace).toHaveBeenCalledWith(HELLO.name);
    expect(puts()).toEqual([]);
  });
});

describe("a program keypair only this device holds", () => {
  beforeEach(() => {
    setUp();
    clearFailures();
  });
  afterEach(() => {
    vi.useRealTimers();
    // Back to jsdom's own getter, which the first test shadows
    delete (document as { visibilityState?: unknown }).visibilityState;
    clearFailures();
    vi.restoreAllMocks();
  });

  const PROGRAM_INFO = ".workspace/program-info.json";
  const DEVICE_KP = Array.from({ length: 64 }, (_, i) => i);
  const ACCOUNT_KP = Array.from({ length: 64 }, (_, i) => 255 - i);
  /** A `program-info.json` as `PgProgramInfo` serialises it */
  const info = (kp: number[] | null, idl: string | null = null) =>
    JSON.stringify({
      uuid: "u",
      idl,
      kp,
      customPk: null,
      lastBuildFailed: false,
    });
  const programInfoPath = `/${HELLO.name}/${PROGRAM_INFO}`;
  const local = () => JSON.parse(storedFiles().get(programInfoPath)!);
  const onServer = () =>
    JSON.parse(
      (server.get(HELLO.id)!.snapshot as { files: Record<string, string> })
        .files[PROGRAM_INFO]
    );

  /**
   * Replaces that land where the real explorer's do, through `PgFs` so the
   * write event the sync effect listens for fires for the generated files
   * exactly as it does in the browser.
   */
  const writesLand = () => {
    vi.spyOn(PgExplorer, "switchWorkspace").mockResolvedValue(undefined);
    return vi
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockImplementation(
        async (name: string, files: Record<string, string>) => {
          // The user files first, replacing the directory as the real
          // replace does; then the generated ones through `PgFs`, so their
          // write events fire
          localFilesAre(
            name,
            Object.fromEntries(
              Object.entries(files).filter(
                ([path]) => !SYNCED_WORKSPACE_FILES.includes(path)
              )
            )
          );
          for (const path of SYNCED_WORKSPACE_FILES) {
            if (path in files)
              await PgFs.writeFile(`/${name}/${path}`, files[path]);
          }
        }
      );
  };

  /** A mark from before per-file hashes, over the user files of `files` */
  const legacyMark = async (
    files: Record<string, string>,
    updatedAt: string
  ) => {
    const pairs = Object.keys(files)
      .filter((path) => !SYNCED_WORKSPACE_FILES.includes(path))
      .sort()
      .map((path) => [path, files[path]]);
    storedFiles().set(
      `/.config/sync/u1/${encodeURIComponent(HELLO.id)}.json`,
      JSON.stringify({
        hash: "whole snapshot",
        contentHash: await sha256(JSON.stringify(pairs)),
        name: HELLO.name,
        updatedAt,
        dirty: false,
      })
    );
  };

  const serverHolds = (files: Record<string, string>) => {
    const updatedAt = tick();
    server.set(HELLO.id, {
      id: HELLO.id,
      name: HELLO.name,
      kind: "tutorial",
      snapshot: { files },
      updatedAt,
    });
    return updatedAt;
  };

  it("is kept when the account's copy is taken, and reaches the account and the other device", async () => {
    // A device from before the upgrade built, which generated the keypair
    // here. Nothing uploaded generated files in that era, so the account's
    // copy has none, and taking it dropped the only keypair there was: the
    // next build minted a new program address.
    const account = { "src/lib.rs": "same", [PROGRAM_INFO]: info(null, "idl") };
    const agreedAt = serverHolds(account);
    await legacyMark(account, agreedAt);
    asDevice([HELLO], "same");
    storedFiles().set(programInfoPath, info(DEVICE_KP));
    writesLand();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    await signedIn();

    // The effect is what uploads it in the browser: the rewrite fires a write
    // event for the keypair file, and its debounced push is the next push
    const pushes: Array<Promise<unknown>> = [];
    const pushCurrent = PgProjectSync.pushCurrent.bind(PgProjectSync);
    vi.spyOn(PgProjectSync, "pushCurrent").mockImplementation(() => {
      const pushed = pushCurrent();
      pushes.push(pushed);
      return pushed;
    });
    vi.useFakeTimers();
    const effect = projectSync();
    try {
      const result = await reconcile();
      expect(result.conflicts).toEqual([]);
      expect(result.replaced).toEqual([HELLO.name]);

      // The account's fields, and this device's keypair
      expect(local()).toEqual({
        ...JSON.parse(info(null, "idl")),
        kp: DEVICE_KP,
      });
      // Recorded as the server's copy, so the keypair reads as owed
      expect((await PgSyncMark.read(HELLO.id))?.files[PROGRAM_INFO]).toBe(
        await sha256(info(null, "idl"))
      );

      vi.advanceTimersByTime(3000);
      expect(pushes).toHaveLength(1);
      expect(await pushes[0]).toBe("ok");
    } finally {
      effect.dispose();
      vi.useRealTimers();
    }

    expect(onServer()).toEqual({
      ...JSON.parse(info(null, "idl")),
      kp: DEVICE_KP,
    });

    // The other device last agreed on the account's keypair-less copy, and
    // has none of its own: it now takes this device's
    asFreshDevice([HELLO], "same");
    await PgSyncMark.write(HELLO.id, {
      files: {
        "src/lib.rs": await sha256("same"),
        [PROGRAM_INFO]: await sha256(info(null, "idl")),
      },
      name: HELLO.name,
      updatedAt: agreedAt,
      dirty: false,
    });
    storedFiles().set(programInfoPath, info(null, "idl"));
    writesLand();

    const other = await reconcile();

    expect(other.replaced).toEqual([HELLO.name]);
    expect(local().kp).toEqual(DEVICE_KP);
  });

  it("is kept when both sides changed the keypair file and the account's has none", async () => {
    asDevice([HELLO], "lib");
    storedFiles().set(programInfoPath, info(null));
    await signedIn();
    expect(await PgProjectSync.pushCurrent()).toBe("ok");

    // The other device rebuilt without a keypair; this one built with one
    otherDeviceWroteFiles(HELLO.id, {
      "src/lib.rs": "lib",
      [PROGRAM_INFO]: info(null, "theirs"),
    });
    localFilesAre(HELLO.name, { "src/lib.rs": "my lib" });
    storedFiles().set(programInfoPath, info(DEVICE_KP));
    writesLand();

    const result = await reconcile();

    expect(result.conflicts).toEqual([]);
    const expected = { ...JSON.parse(info(null, "theirs")), kp: DEVICE_KP };
    expect(local()).toEqual(expected);
    expect(onServer()).toEqual(expected);
    expect(
      (server.get(HELLO.id)!.snapshot as { files: Record<string, string> })
        .files["src/lib.rs"]
    ).toBe("my lib");
  });

  it("gives way to the account's keypair when the account's copy is taken", async () => {
    const account = {
      "src/lib.rs": "same",
      [PROGRAM_INFO]: info(ACCOUNT_KP, "idl"),
    };
    const agreedAt = serverHolds(account);
    await legacyMark(account, agreedAt);
    asDevice([HELLO], "same");
    storedFiles().set(programInfoPath, info(DEVICE_KP));
    writesLand();
    await signedIn();

    await reconcile();
    await PgProjectSync.pushCurrent();

    expect(local().kp).toEqual(ACCOUNT_KP);
    expect(onServer().kp).toEqual(ACCOUNT_KP);
  });

  it("gives way to the account's keypair when both sides changed the file", async () => {
    asDevice([HELLO], "lib");
    storedFiles().set(programInfoPath, info(null));
    await signedIn();
    expect(await PgProjectSync.pushCurrent()).toBe("ok");

    otherDeviceWroteFiles(HELLO.id, {
      "src/lib.rs": "lib",
      [PROGRAM_INFO]: info(ACCOUNT_KP, "theirs"),
    });
    localFilesAre(HELLO.name, { "src/lib.rs": "my lib" });
    storedFiles().set(programInfoPath, info(DEVICE_KP));
    writesLand();

    const result = await reconcile();

    expect(result.conflicts).toEqual([]);
    expect(local()).toEqual(JSON.parse(info(ACCOUNT_KP, "theirs")));
    expect(onServer()).toEqual(JSON.parse(info(ACCOUNT_KP, "theirs")));
  });
});

describe("the exchange after typing was folded into a rewrite", () => {
  beforeEach(() => {
    setUp();
    clearFailures();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });
  afterEach(() => {
    effect?.dispose();
    effect = null;
    editor?.dispose();
    editor = null;
    delete (document as { visibilityState?: unknown }).visibilityState;
    clearFailures();
    vi.restoreAllMocks();
  });

  let effect: { dispose: () => void } | null = null;
  const base = "a\nb\nc\nd\ne\nf\ng\n";
  const path = `/${HELLO.name}/src/lib.rs`;

  /**
   * An explorer whose re-open behaves like the real one: a rewrite lands in
   * the store, and re-opening reads the workspace back out of it and then
   * announces the switch -- which is what the sync effect takes its shadow
   * from. `captureWrites` stubs the re-open out, and with it the one moment
   * the shadow is re-taken, so a test built on it cannot see what the shadow
   * holds after a fold.
   */
  const explorerReopensFromTheStore = () => {
    const prefix = `/${HELLO.name}/`;
    vi.spyOn(PgExplorer, "replaceWorkspaceFiles").mockImplementation(
      async (name: string, files: Record<string, string>) => {
        for (const [path, content] of Object.entries(files)) {
          await PgFs.writeFile(`/${name}/${path}`, content, {
            createParents: true,
          });
        }
      }
    );
    vi.spyOn(PgExplorer, "switchWorkspace").mockImplementation(async () => {
      localFilesAre(
        HELLO.name,
        Object.fromEntries(
          [...storedFiles()]
            .filter(([full]) => full.startsWith(prefix))
            .map(([full, content]) => [full.slice(prefix.length), content])
            .filter(([rel]) => !rel.startsWith("."))
        )
      );
      PgCommon.createAndDispatchCustomEvent(
        PgExplorer.events.ON_DID_SWITCH_WORKSPACE
      );
    });
  };

  /** Both browsers agree on `base`, and this one runs the sync effect */
  const inSync = async () => {
    asDevice([HELLO]);
    localFilesAre(HELLO.name, { "src/lib.rs": base });
    await PgFs.writeFile(path, base, { createParents: true });
    await signedIn();
    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    explorerReopensFromTheStore();
    effect = projectSync();
  };

  /** Let the passes the effect started run out, then run one more */
  const settle = async () => {
    for (let i = 0; i < 3; i++) await reconcile();
  };

  it("merges the next change from the other device after a merge folded in typing", async () => {
    await inSync();
    // The other device changes the first line; this one the last, and the
    // user goes on typing on the fourth while the merge runs
    otherDeviceWroteFiles(HELLO.id, { "src/lib.rs": "A\nb\nc\nd\ne\nf\ng\n" });
    localFilesAre(HELLO.name, { "src/lib.rs": "a\nb\nc\nd\ne\nf\nG\n" });
    const buffers = editorHolds({ [path]: "a\nb\nc\nD\ne\nf\nG\n" });

    // The other device takes the merged copy and changes the second line,
    // landing before this device's typing is uploaded
    const online = global.fetch;
    let puts = 0;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const response = await online(url, init);
      if (init?.method === "PUT" && ++puts === 2) {
        expect(response.ok).toBe(true);
        otherDeviceWroteFiles(HELLO.id, {
          "src/lib.rs": "A\nB\nc\nd\ne\nf\nG\n",
        });
      }
      return response;
    }) as unknown as typeof fetch;

    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    await settle();

    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "A\nB\nc\nD\ne\nf\nG\n" },
    });
    expect(buffers.get(path)).toBe("A\nB\nc\nD\ne\nf\nG\n");
  });

  it("merges the next change from the other device after taking its copy folded in typing", async () => {
    await inSync();
    otherDeviceWroteFiles(HELLO.id, { "src/lib.rs": "A\nb\nc\nd\ne\nf\ng\n" });
    const buffers = editorHolds({ [path]: base });

    // Typed during the adoption's fetch, not yet autosaved: folded into the
    // account's copy. Then the other device writes again before this
    // device's next pass reads the account.
    const online = global.fetch;
    let reads = 0;
    let lists = 0;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method && url === "/api/projects" && ++lists === 2) {
        otherDeviceWroteFiles(HELLO.id, {
          "src/lib.rs": "A\nB\nc\nd\ne\nf\ng\n",
        });
      }
      const response = await online(url, init);
      if (!init?.method && url.includes("id=") && ++reads === 1) {
        buffers.set(path, "a\nb\nc\nD\ne\nf\ng\n");
      }
      return response;
    }) as unknown as typeof fetch;

    expect((await reconcile()).replaced).toEqual([HELLO.name]);
    await settle();

    expect(PgProjectSync.conflictFor(HELLO.id)).toBeNull();
    expect(server.get(HELLO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "A\nB\nc\nD\ne\nf\ng\n" },
    });
    expect(buffers.get(path)).toBe("A\nB\nc\nD\ne\nf\ng\n");
  });
});

describe("picking up where the account left off", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  it("names the most recently touched project, so it can be opened", async () => {
    asDevice([{ id: "older", name: "Older" }]);
    await signedIn();
    await PgProjectSync.pushCurrent();
    vi.restoreAllMocks();
    asDevice([{ id: "newer", name: "Newer" }]);
    await PgProjectSync.pushCurrent();

    asFreshDevice([]);
    await signedIn();

    expect((await reconcile()).latest).toBe("Newer");
  });

  it("imports a project once when two reconciles are asked for at once", async () => {
    // Load asks twice: the session effect's own reconcile, and the one the
    // explorer's first switch starts. Overlapping, the second saw the
    // workspace the first had imported but not yet marked, took it for a
    // copy with work of its own, and renamed the account's row to its
    // de-duplicated local name. Or it imported the project a second time.
    server.set("p1", {
      id: "p1",
      name: "Alpha",
      kind: "project",
      snapshot: { files: { "src/lib.rs": "from the laptop" } },
      updatedAt: tick(),
    });
    const workspaces: Array<{ id: string; name: string }> = [];
    asDevice(workspaces);
    const importWorkspace = vi
      .spyOn(PgExplorer, "importWorkspace")
      .mockImplementation(async (name: string, opts) => {
        workspaces.push({ id: opts.id, name });
        for (const [path, content] of Object.entries(opts.files)) {
          storedFiles().set(`/${name}/${path}`, content);
        }
      });
    await signedIn();

    const [first, second] = await Promise.all([reconcile(), reconcile()]);

    expect(importWorkspace).toHaveBeenCalledTimes(1);
    expect(first.imported).toEqual(["Alpha"]);
    expect(second.imported).toEqual([]);
    expect(first.conflicts).toEqual([]);
    expect(second.conflicts).toEqual([]);
    expect(PgProjectSync.conflicts).toEqual([]);
    expect(
      (global.fetch as Mock).mock.calls.filter(
        ([, init]) => init?.method === "PUT"
      )
    ).toEqual([]);
    expect(server.get("p1")!.name).toBe("Alpha");
  });

  it("hands over a project made before signing in", async () => {
    // Only the editor's change handler used to push, so a project that was
    // made and then left alone never reached the account at all
    asDevice([{ id: "local-only", name: "Scratch" }]);
    await signedIn();

    const result = await reconcile();

    expect(result.pushed).toEqual(["Scratch"]);
    expect(server.get("local-only")!.snapshot).toEqual({
      files: { "src/lib.rs": "declare_id!();" },
    });
  });

  it("pushes from inside the gate it is holding", async () => {
    // `reconcile` runs with pushes held, and releases them when it returns.
    // A push issued from inside it that waited on that gate would wait for
    // itself, and the pass would hang with nothing uploaded -- which is what
    // happened, and which no test mocking `push` could ever see.
    asDevice([{ id: "local-only", name: "Scratch" }]);
    await signedIn();
    PgProjectSync.holdPushes();

    const result = await Promise.race([
      reconcile(),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 1000)),
    ]);

    expect(result).not.toBe("hung");
    expect(server.get("local-only")).toBeDefined();
    PgProjectSync.releasePushes();
  });
});

describe("signing out of a browser", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  /**
   * Take the workspace off this device the way `PgExplorer` does.
   *
   * The event at the end is the point: the real `deleteWorkspace` dispatches
   * it unconditionally, and the `project-sync` effect is subscribed to it.
   */
  const explorerForgets = (workspaces: Array<{ id: string; name: string }>) =>
    vi
      .spyOn(PgExplorer, "deleteWorkspace")
      .mockImplementation(async (name?: string) => {
        const index = workspaces.findIndex((w) => w.name === name);
        if (index >= 0) workspaces.splice(index, 1);
        // Saved before the event, as the real delete does: what the effect
        // settles a delete against is the store's list
        storedFiles().set(
          PgWorkspace.WORKSPACES_CONFIG_PATH,
          JSON.stringify({ workspaces })
        );
        PgCommon.createAndDispatchCustomEvent(
          PgExplorer.events.ON_DID_DELETE_WORKSPACE
        );
      });

  it("leaves the account's projects on the server", async () => {
    // Sign-out removes this browser's copy of projects the account keeps, so
    // the next person here is not shown them. It is not the user deleting
    // their work -- but it reaches the `project-sync` effect as the same
    // event, and that effect answers a workspace that no longer resolves by
    // tombstoning it. Signing out therefore emptied the account, and signing
    // back in restored nothing because there was nothing left to restore.
    const workspaces = [{ id: "p1", name: "Alpha" }];
    asDevice(workspaces);
    await signedIn();

    // On the server, and this device's mark says so -- which is what makes it
    // eligible for release in the first place
    await reconcile();
    expect(server.get("p1")!.snapshot).toBeTruthy();

    explorerForgets(workspaces);
    const effect = projectSync();
    try {
      await releaseLocalProjects();
      // The effect's subscriber awaits the mark listing and then a call per
      // orphaned project
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      effect.dispose();
    }

    expect(server.get("p1")!.deleted).toBeFalsy();
    expect(server.get("p1")!.snapshot).toBeTruthy();
  });

  it("gives them back on the next sign-in", async () => {
    // The whole round trip, which is how this was reported: sign out, sign
    // back in, and the projects list is empty -- and stays empty through a
    // reload, because the emptiness is on the server by then
    const workspaces = [{ id: "p1", name: "Alpha" }];
    asDevice(workspaces);
    await signedIn();
    await reconcile();

    explorerForgets(workspaces);
    const effect = projectSync();
    try {
      await releaseLocalProjects();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      effect.dispose();
    }
    // Gone from this browser, which is the point of releasing it
    expect(workspaces).toEqual([]);

    // Signing back in. The marks were left behind on purpose and the
    // workspace was not, which is exactly the "never had it" case.
    const result = await reconcile();

    expect(result.imported).toEqual(["Alpha"]);
  });

  it("still tombstones a project the user deletes by hand", async () => {
    // The other half of the same event. Without this the fix is just a
    // disabled delete, and a project removed here comes back on the next load.
    const workspaces = [{ id: "p1", name: "Alpha" }];
    asDevice(workspaces);
    await signedIn();
    await reconcile();

    explorerForgets(workspaces);
    const effect = projectSync();
    try {
      await PgExplorer.deleteWorkspace("Alpha");
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      effect.dispose();
    }

    expect(server.get("p1")!.deleted).toBe(true);
  });
});

describe("a project renamed on one device", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const FOO = { id: "p1", name: "Foo" };
  /** A fresh copy of the entry, which a rename here mutates */
  const foo = () => ({ id: FOO.id, name: FOO.name });
  const bar = () => ({ id: "p2", name: "Bar" });

  /**
   * A rename in this browser's explorer: the entry and its files move. The
   * entries are the ones `asDevice` reads through, so every name it mocks
   * follows.
   */
  const renameLocally = (
    workspaces: Array<{ id: string; name: string }>,
    from: string,
    to: string
  ) => {
    const entry = workspaces.find((w) => w.name === from)!;
    for (const [path, content] of [...storedFiles().entries()]) {
      if (!path.startsWith(`/${from}/`)) continue;
      storedFiles().delete(path);
      storedFiles().set(`/${to}${path.slice(from.length + 1)}`, content);
    }
    entry.name = to;
  };

  /**
   * The user renaming it here. The project-sync effect flags the project on
   * `onDidRenameWorkspace`, and without the flag reconcile's cheap path reads
   * an unmoved row as nothing to do.
   */
  const userRenamed = async (
    workspaces: Array<{ id: string; name: string }>,
    from: string,
    to: string
  ) => {
    const entry = workspaces.find((w) => w.name === from)!;
    renameLocally(workspaces, from, to);
    await PgSyncMark.markDirty(entry.id);
  };

  /** The other browser renamed it, which moves the row on */
  const otherDeviceRenamed = (id: string, name: string) => {
    const existing = server.get(id)!;
    server.set(id, {
      id: existing.id,
      name,
      kind: existing.kind,
      snapshot: existing.snapshot,
      updatedAt: tick(),
    });
  };

  /** Both devices agree on the project, and renames go through the explorer */
  const inSync = async (workspaces: Array<{ id: string; name: string }>) => {
    asDevice(workspaces);
    await signedIn();
    await PgProjectSync.pushCurrent();
    // Refusing what the real one refuses, the name rule included: a
    // stepped-around name the rule rejects failed every clash
    const rename = vi
      .spyOn(PgExplorer, "renameWorkspace")
      .mockImplementation(async (to, opts) => {
        to = to.trim();
        if (!PgExplorer.isWorkspaceNameValid(to)) {
          throw new Error(PgWorkspace.errors.INVALID_NAME);
        }
        if (workspaces.some((w) => w.name === to)) {
          throw new Error(PgWorkspace.errors.ALREADY_EXISTS);
        }
        renameLocally(workspaces, opts?.from ?? workspaces[0].name, to);
      });
    vi.spyOn(PgExplorer, "replaceWorkspaceFiles").mockImplementation(
      async (name: string, files) => {
        writeStored(name, files);
      }
    );
    vi.spyOn(PgExplorer, "switchWorkspace").mockResolvedValue(undefined);
    return rename;
  };

  it("takes the new name here, and keeps it on the next edit", async () => {
    // HOO-1726: the name came back because this device never took it, and
    // then uploaded its own old one as authoritative
    const workspaces = [foo()];
    const rename = await inSync(workspaces);

    otherDeviceRenamed(FOO.id, "Bar");
    await reconcile();

    expect(rename).toHaveBeenCalledWith("Bar", { from: "Foo" });
    expect(workspaces[0].name).toBe("Bar");

    storedFiles().set("/Bar/src/lib.rs", "an edit after the rename");
    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    expect(server.get(FOO.id)!.name).toBe("Bar");
  });

  it("takes the new name in a merge too, when only the other device renamed it", async () => {
    // Both sides moved the files, so this is a merge rather than an adopt --
    // which recorded the server's name, kept the old one here, and uploaded
    // the old one straight back
    const workspaces = [foo()];
    const rename = await inSync(workspaces);
    writeStored("Foo", { "src/lib.rs": "a\nb\nc\n" });
    await PgProjectSync.pushCurrent();

    otherDeviceRenamed(FOO.id, "Bar");
    otherDeviceWroteFiles(FOO.id, { "src/lib.rs": "a\nb\nC\n" });
    writeStored("Foo", { "src/lib.rs": "A\nb\nc\n" });
    await PgSyncMark.markDirty(FOO.id);

    expect((await reconcile()).conflicts).toEqual([]);
    expect(rename).toHaveBeenCalledWith("Bar", { from: "Foo" });
    expect(server.get(FOO.id)!.name).toBe("Bar");
    expect(server.get(FOO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "A\nb\nC\n" },
    });
  });

  it("uploads a rename made here", async () => {
    const workspaces = [foo()];
    const rename = await inSync(workspaces);

    await userRenamed(workspaces, "Foo", "Baz");
    await reconcile();

    expect(rename).not.toHaveBeenCalled();
    expect(server.get(FOO.id)!.name).toBe("Baz");
  });

  it("uploads this device's name when both renamed it and nothing else", async () => {
    const workspaces = [foo()];
    const rename = await inSync(workspaces);

    otherDeviceRenamed(FOO.id, "Bar");
    await userRenamed(workspaces, "Foo", "Baz");
    const result = await reconcile();

    expect(rename).not.toHaveBeenCalled();
    expect(result.conflicts).toEqual([]);
    expect(server.get(FOO.id)!.name).toBe("Baz");
  });

  it("takes the other name along with the other files when asked", async () => {
    const workspaces = [foo()];
    const rename = await inSync(workspaces);

    otherDeviceRenamed(FOO.id, "Bar");
    otherDeviceWrote(FOO.id, "the other device");
    await userRenamed(workspaces, "Foo", "Baz");
    storedFiles().set("/Baz/src/lib.rs", "work of this device's own");

    expect((await reconcile()).conflicts).toEqual([
      expect.objectContaining({ projectId: FOO.id, kind: "divergent" }),
    ]);
    expect(rename).not.toHaveBeenCalled();

    expect(await PgProjectSync.resolve(FOO.id, "take-server")).toBe(true);
    expect(rename).toHaveBeenCalledWith("Bar", { from: "Baz" });
    expect(server.get(FOO.id)!.name).toBe("Bar");
  });

  it("keeps this device's name along with its files when asked", async () => {
    const workspaces = [foo()];
    await inSync(workspaces);

    otherDeviceRenamed(FOO.id, "Bar");
    otherDeviceWrote(FOO.id, "the other device");
    await userRenamed(workspaces, "Foo", "Baz");
    storedFiles().set("/Baz/src/lib.rs", "work of this device's own");
    await reconcile();

    expect(await PgProjectSync.resolve(FOO.id, "keep-local")).toBe(true);
    expect(server.get(FOO.id)!.name).toBe("Baz");
  });

  it("still takes the files when the rename fails", async () => {
    const workspaces = [foo()];
    const rename = await inSync(workspaces);
    rename.mockRejectedValue(new Error("Invalid name"));

    otherDeviceRenamed(FOO.id, "Bar");
    otherDeviceWrote(FOO.id, "the other device");
    await reconcile();

    expect(PgExplorer.replaceWorkspaceFiles).toHaveBeenCalledWith("Foo", {
      "src/lib.rs": "the other device",
    });
  });

  it("follows a rename that moved the workspace before it failed", async () => {
    const workspaces = [foo()];
    const rename = await inSync(workspaces);
    rename.mockImplementationOnce(async (to, opts) => {
      renameLocally(workspaces, opts!.from!, to);
      throw new Error("save failed");
    });

    otherDeviceRenamed(FOO.id, "Bar");
    await reconcile();

    expect(workspaces[0].name).toBe("Bar");
    expect((await PgSyncMark.read(FOO.id))!.localName).toBeUndefined();
  });

  it("gives the name back once a project renamed elsewhere moves off it", async () => {
    // The other device renamed "Bar" to "Baz", then "Foo" to "Bar". Newest
    // first, so this device reaches "Foo" while its "Bar" still holds the
    // name -- and the stepped-around name used to stay, and go up next edit.
    const workspaces = [foo(), bar()];
    const rename = await inSync(workspaces);
    storedFiles().set("/Bar/src/lib.rs", "declare_id!();");
    await PgProjectSync.push("p2", await snapshotOf("Bar"), "Bar", {
      immediate: true,
    });

    otherDeviceRenamed("p2", "Baz");
    otherDeviceRenamed(FOO.id, "Bar");
    await reconcile();

    expect(rename).toHaveBeenCalledWith("Bar imported", { from: "Foo" });
    expect(workspaces.map((w) => w.name)).toEqual(["Bar", "Baz"]);

    storedFiles().set("/Bar/src/lib.rs", "an edit after the renames");
    await PgProjectSync.pushCurrent();
    expect(server.get(FOO.id)!.name).toBe("Bar");
  });

  it("never uploads the stand-in name a clash left, on any later edit", async () => {
    // The merge's own upload kept the server's name, and the next ordinary
    // push sent the stepped one -- which renamed the project on every device
    // and could never be given back
    const workspaces = [foo(), bar()];
    await inSync(workspaces);

    otherDeviceRenamed(FOO.id, "Bar");
    await reconcile();
    expect(workspaces[0].name).toBe("Bar imported");

    storedFiles().set("/Bar imported/src/lib.rs", "an edit here");
    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    expect(server.get(FOO.id)!.name).toBe("Bar");
    expect(server.get(FOO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "an edit here" },
    });
  });

  it("does not send the old name back when the rename here failed", async () => {
    const workspaces = [foo()];
    const rename = await inSync(workspaces);
    rename.mockRejectedValue(new Error("Invalid name"));

    otherDeviceRenamed(FOO.id, "Bar");
    await reconcile();
    expect(workspaces[0].name).toBe("Foo");

    storedFiles().set("/Foo/src/lib.rs", "an edit here");
    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    expect(server.get(FOO.id)!.name).toBe("Bar");
  });

  it("uploads a name the user gives a stand-in", async () => {
    const workspaces = [foo(), bar()];
    await inSync(workspaces);
    otherDeviceRenamed(FOO.id, "Bar");
    await reconcile();

    await userRenamed(workspaces, "Bar imported", "Qux");
    await reconcile();
    expect(server.get(FOO.id)!.name).toBe("Qux");
  });

  /** An import that does what the explorer's does to the list and the store */
  const importsInto = (workspaces: Array<{ id: string; name: string }>) =>
    vi
      .spyOn(PgExplorer, "importWorkspace")
      .mockImplementation(async (name, opts) => {
        if (workspaces.some((w) => w.name === name)) {
          throw new Error(PgWorkspace.errors.ALREADY_EXISTS);
        }
        writeStored(name, opts.files);
        workspaces.push({ id: opts.id, name });
      });

  /** Every upload refused with a 500, everything else answered as usual */
  const uploadsFail = () => {
    global.fetch = vi.fn(
      async (url: string, init?: RequestInit): Promise<unknown> =>
        init?.method === "PUT"
          ? { ok: false, status: 500, json: async () => ({}) }
          : fakeFetch(url, init)
    ) as unknown as typeof fetch;
  };
  const uploadsWork = () => {
    global.fetch = vi.fn(fakeFetch) as unknown as typeof fetch;
  };

  it("imports a new project beside one just renamed onto its name", async () => {
    // One pass, newest first: "Foo" renamed to "Bar" elsewhere, and a new
    // project also called "Bar". The import went by the names from before
    // the rename, and wrote the new project's files into the renamed one.
    const workspaces = [foo()];
    await inSync(workspaces);
    importsInto(workspaces);
    server.set("p3", {
      id: "p3",
      name: "Bar",
      kind: "project",
      snapshot: { files: { "src/lib.rs": "the new project" } },
      updatedAt: tick(),
    });
    otherDeviceRenamed(FOO.id, "Bar");

    await reconcile();

    expect(workspaces).toEqual([
      { id: FOO.id, name: "Bar" },
      { id: "p3", name: "Bar imported" },
    ]);
    expect(storedFiles().get("/Bar/src/lib.rs")).toBe("declare_id!();");
    expect(storedFiles().get("/Bar imported/src/lib.rs")).toBe(
      "the new project"
    );

    // The stepped name is a stand-in, and stays off the account
    storedFiles().set("/Bar imported/src/lib.rs", "an edit here");
    expect(
      await PgProjectSync.push(
        "p3",
        await snapshotOf("Bar imported"),
        "Bar imported",
        { immediate: true }
      )
    ).toBe("ok");
    expect(server.get("p3")!.name).toBe("Bar");
  });

  it("gives the name back in the same pass when its holder was deleted elsewhere", async () => {
    const workspaces = [foo(), bar()];
    const rename = await inSync(workspaces);
    storedFiles().set("/Bar/src/lib.rs", "declare_id!();");
    await PgProjectSync.push("p2", await snapshotOf("Bar"), "Bar", {
      immediate: true,
    });
    vi.spyOn(PgExplorer, "deleteWorkspace").mockImplementation(
      async (name?: string) => {
        workspaces.splice(
          workspaces.findIndex((w) => w.name === name),
          1
        );
      }
    );

    otherDeviceDeleted("p2");
    otherDeviceRenamed(FOO.id, "Bar");
    const result = await reconcile();

    expect(result.removed).toEqual(["Bar"]);
    expect(rename).toHaveBeenLastCalledWith("Bar", { from: "Bar imported" });
    expect(workspaces).toEqual([{ id: FOO.id, name: "Bar" }]);
  });

  it("keeps a rename made here owed when the merge's upload fails", async () => {
    const workspaces = [foo()];
    await inSync(workspaces);

    otherDeviceRenamed(FOO.id, "Bar");
    await userRenamed(workspaces, "Foo", "Baz");
    uploadsFail();
    await reconcile();

    const mark = await PgSyncMark.read(FOO.id);
    expect(mark).toEqual(expect.objectContaining({ name: "Bar", dirty: true }));
    expect(mark!.localName).toBeUndefined();

    uploadsWork();
    await reconcile();
    expect(server.get(FOO.id)!.name).toBe("Baz");
  });

  it("keeps a stand-in off the account when the merge's upload fails", async () => {
    const workspaces = [foo(), bar()];
    await inSync(workspaces);
    writeStored("Foo", { "src/lib.rs": "a\nb\nc\n" });
    await PgProjectSync.pushCurrent();

    otherDeviceRenamed(FOO.id, "Bar");
    otherDeviceWroteFiles(FOO.id, { "src/lib.rs": "a\nb\nC\n" });
    writeStored("Foo", { "src/lib.rs": "A\nb\nc\n" });
    await PgSyncMark.markDirty(FOO.id);
    uploadsFail();
    await reconcile();

    expect(workspaces[0].name).toBe("Bar imported");
    expect(await PgSyncMark.read(FOO.id)).toEqual(
      expect.objectContaining({
        name: "Bar",
        localName: "Bar imported",
        dirty: true,
      })
    );

    uploadsWork();
    await reconcile();
    expect(server.get(FOO.id)!.name).toBe("Bar");
    expect(server.get(FOO.id)!.snapshot).toEqual({
      files: { "src/lib.rs": "A\nb\nC\n" },
    });
  });

  it("settles a failed rename on a later pass, and reverts nothing", async () => {
    const workspaces = [foo()];
    const rename = await inSync(workspaces);
    // The adopt's rename, and the retry at the end of the same pass
    rename
      .mockRejectedValueOnce(new Error("quota"))
      .mockRejectedValueOnce(new Error("quota"));

    otherDeviceRenamed(FOO.id, "Bar");
    await reconcile();
    expect(workspaces[0].name).toBe("Foo");
    expect(server.get(FOO.id)!.name).toBe("Bar");
    clearFailures();

    await reconcile();
    expect(workspaces[0].name).toBe("Bar");
    await reconcile();

    expect(rename).toHaveBeenCalledTimes(3);
    expect(server.get(FOO.id)!.name).toBe("Bar");
    expect(getFailures()).toEqual([]);
  });

  it("takes a name the server holds with spaces round it, once", async () => {
    const workspaces = [foo()];
    const rename = await inSync(workspaces);

    otherDeviceRenamed(FOO.id, " Bar ");
    await reconcile();
    await reconcile();

    expect(rename).toHaveBeenCalledTimes(1);
    expect(workspaces[0].name).toBe("Bar");
    expect((await PgSyncMark.read(FOO.id))!.name).toBe("Bar");
  });

  it("leaves a name the explorer refuses alone, without a report", async () => {
    // A name from before the explorer's rule, which a rename here would be
    // refused on every pass
    const workspaces = [foo()];
    const rename = await inSync(workspaces);
    clearFailures();

    otherDeviceRenamed(FOO.id, "Bar (old)");
    await reconcile();
    await reconcile();

    expect(rename).not.toHaveBeenCalled();
    expect(workspaces[0].name).toBe("Foo");
    expect(getFailures()).toEqual([]);

    storedFiles().set("/Foo/src/lib.rs", "an edit here");
    expect(await PgProjectSync.pushCurrent()).toBe("ok");
    expect(server.get(FOO.id)!.name).toBe("Bar (old)");
  });
});
