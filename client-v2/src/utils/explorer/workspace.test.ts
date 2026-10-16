import { PgWorkspace } from "./workspace";

/** The shape every existing user has on disk today */
const legacy = (allNames: string[], currentName?: string) =>
  PgWorkspace.migrate({ allNames, currentName } as never);

describe("PgWorkspace.migrate", () => {
  it("mints an id for each name in the legacy shape", () => {
    const ws = new PgWorkspace(legacy(["a", "b"], "b"));

    expect(ws.allNames).toEqual(["a", "b"]);
    expect(ws.idOf("a")).toEqual(expect.any(String));
    expect(ws.idOf("a")).not.toBe(ws.idOf("b"));
  });

  it("keeps the current workspace pointing at the same one", () => {
    const ws = new PgWorkspace(legacy(["a", "b"], "b"));

    expect(ws.currentName).toBe("b");
    expect(ws.currentId).toBe(ws.idOf("b"));
  });

  it("leaves an already-migrated shape untouched, so it is idempotent", () => {
    const migrated = {
      workspaces: [{ id: "keep-me", name: "a" }],
      currentId: "keep-me",
    };

    expect(PgWorkspace.migrate(migrated)).toEqual(migrated);
    expect(PgWorkspace.migrate(PgWorkspace.migrate(migrated))).toEqual(
      migrated
    );
  });

  it("survives an empty or absent legacy config", () => {
    expect(new PgWorkspace(legacy([])).allNames).toEqual([]);
    expect(PgWorkspace.migrate({} as never).workspaces).toEqual([]);
  });

  it("drops a currentName that names no workspace", () => {
    const ws = new PgWorkspace(legacy(["a"], "gone"));

    expect(ws.currentId).toBeUndefined();
    expect(ws.currentName).toBeUndefined();
  });
});

describe("PgWorkspace ids", () => {
  it("keeps the id stable across a rename -- the whole point", () => {
    const ws = new PgWorkspace(legacy(["a"], "a"));
    const before = ws.idOf("a");

    ws.rename("b");

    expect(ws.allNames).toEqual(["b"]);
    expect(ws.idOf("b")).toBe(before);
    expect(ws.currentId).toBe(before);
  });

  it("gives a new workspace its own id and makes it current", () => {
    const ws = new PgWorkspace(legacy(["a"], "a"));

    ws.create("b");

    expect(ws.allNames).toEqual(["a", "b"]);
    expect(ws.currentName).toBe("b");
    expect(ws.idOf("b")).not.toBe(ws.idOf("a"));
  });

  it("refuses a duplicate name", () => {
    const ws = new PgWorkspace(legacy(["a"], "a"));

    expect(() => ws.create("a")).toThrow(PgWorkspace.errors.ALREADY_EXISTS);
    expect(() => ws.rename("a")).toThrow(PgWorkspace.errors.ALREADY_EXISTS);
  });

  it("refuses to rename a workspace that is not there", () => {
    const ws = new PgWorkspace(legacy(["a"], "a"));

    expect(() => ws.rename("b", "nope")).toThrow(PgWorkspace.errors.NOT_FOUND);
    expect(ws.allNames).toEqual(["a"]);
  });

  it("drops the entry on delete", () => {
    const ws = new PgWorkspace(legacy(["a", "b"], "b"));

    ws.delete("a");

    expect(ws.allNames).toEqual(["b"]);
    expect(ws.idOf("a")).toBeUndefined();
  });

  it("clears the current pointer when the current workspace is deleted", () => {
    const ws = new PgWorkspace(legacy(["a", "b"], "b"));

    ws.delete("b");

    expect(ws.currentName).toBeUndefined();
    expect(ws.currentId).toBeUndefined();
  });

  it("round-trips through get() without losing ids", () => {
    const ws = new PgWorkspace(legacy(["a", "b"], "a"));
    const id = ws.idOf("b");

    const revived = new PgWorkspace(PgWorkspace.migrate(ws.get()));

    expect(revived.idOf("b")).toBe(id);
    expect(revived.currentName).toBe("a");
  });

  it("derives a tutorial's id from its name, so devices agree on it", () => {
    PgWorkspace.setIsTutorialName((name) => name === "Hello Anchor");
    try {
      const one = new PgWorkspace(legacy([]));
      const two = new PgWorkspace(legacy([]));
      one.create("Hello Anchor");
      two.create("Hello Anchor");

      expect(one.idOf("Hello Anchor")).toBe("tut:hello-anchor");
      // Two devices, no coordination, same id
      expect(two.idOf("Hello Anchor")).toBe(one.idOf("Hello Anchor"));
    } finally {
      PgWorkspace.setIsTutorialName(() => false);
    }
  });

  it("gives two same-named personal projects different ids", () => {
    const one = new PgWorkspace(legacy([]));
    const two = new PgWorkspace(legacy([]));
    one.create("my-program");
    two.create("my-program");

    expect(one.idOf("my-program")).not.toBe(two.idOf("my-program"));
  });
});

describe("PgWorkspace.DEFAULT", () => {
  it("is a fresh state each time, not one everybody shares", () => {
    // The constructor takes it as the state rather than a copy of it, so a
    // shared constant becomes whatever the first instance does to it -- and
    // the next `new PgWorkspace()`, which is how the explorer resets itself,
    // gets that back instead of an empty one
    const one = new PgWorkspace();
    one.create("alpha");

    expect(new PgWorkspace().allNames).toEqual([]);
    expect(PgWorkspace.DEFAULT.workspaces).toEqual([]);
  });

  it("is not written through by the state that adopts it", () => {
    // How it happened in practice: `_initWorkspaces` constructs empty and then
    // fills the instance in from disk
    const workspace = new PgWorkspace();
    workspace.setCurrent({
      workspaces: [{ id: "w1", name: "alpha" }],
      currentId: "w1",
    });

    expect(PgWorkspace.DEFAULT).toEqual({ workspaces: [] });
  });
});
