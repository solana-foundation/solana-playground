/** What the user chose on top of their open tabs, for one workspace */
export interface ContextChoice {
  /** Files added from the composer's + menu, in the order they were added */
  readonly added: readonly string[];
  /** Files taken out with a chip's remove button, open tabs included */
  readonly removed: readonly string[];
}

const EMPTY: ContextChoice = { added: [], removed: [] };

/**
 * The files that go to the model: the open tabs in tab order, then the added
 * files, minus what the user removed and what no longer exists.
 *
 * A removed tab stays out while it is open: removal outlasts tab switches
 * until the user adds the file back.
 *
 * @param exists whether a path is still a file of the project
 * @returns from the open tabs' relative paths, in tab order, and what the
 * user added and removed: relative paths, each once
 */
export const contextPathsWith =
  (exists: (path: string) => boolean) =>
  (tabs: readonly string[], choice: ContextChoice): string[] => {
    const removed = new Set(choice.removed);
    const paths = [...new Set([...tabs, ...choice.added])];
    return paths.filter((path) => !removed.has(path) && exists(path));
  };

/**
 * A path the model wrote, as the project-relative path the context lists.
 *
 * `./`, `.`, repeated `/`, backslashes and a leading `/` are read the way a
 * person would; `..` is resolved. Kept pure so the spellings are tested here,
 * not through the explorer.
 *
 * @param path what the model asked for, e.g. `/src/lib.rs`
 * @returns the relative path, or `undefined` for an empty path or one that
 * leaves the project
 */
export const normalizeProjectPath = (path: string): string | undefined => {
  const parts: string[] = [];
  for (const part of path.trim().replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") {
      parts.push(part);
      continue;
    }
    if (parts.length === 0) return;
    parts.pop();
  }
  return parts.length ? parts.join("/") : undefined;
};

/** `path` itself, or a file under it when it is a folder */
const isAtOrUnder = (path: string, target: string) =>
  path === target || path.startsWith(`${target}/`);

/**
 * The user's context choices, one per workspace.
 *
 * Keyed by the workspace's stable id, so a rename keeps the choice and a
 * visit to another project does not drop it: a removal is the user keeping
 * a file from the model provider, and losing it would send that file again.
 * Kept in memory only, so a reload starts from the open tabs.
 */
class AssistantContextStore {
  private readonly choices = new Map<string | undefined, ContextChoice>();
  private readonly listeners = new Set<() => void>();

  /** The choice for `workspace`; empty until one is made there */
  choice(workspace: string | undefined): ContextChoice {
    return this.choices.get(workspace) ?? EMPTY;
  }

  /** Puts `path` into the context, undoing an earlier removal */
  add(workspace: string | undefined, path: string) {
    const { added, removed } = this.choice(workspace);
    this.write(workspace, {
      added: added.includes(path) ? added : [...added, path],
      removed: removed.filter((p) => p !== path),
    });
  }

  /** Keeps `path` out of the context until it is added back */
  remove(workspace: string | undefined, path: string) {
    const { added, removed } = this.choice(workspace);
    this.write(workspace, {
      added: added.filter((p) => p !== path),
      removed: removed.includes(path) ? removed : [...removed, path],
    });
  }

  /**
   * Drops every choice about `path` and what is under it: a deleted file's.
   * A new file made at that path later is the user's to add, not an old pick
   */
  forget(workspace: string | undefined, path: string) {
    const { added, removed } = this.choice(workspace);
    this.write(workspace, {
      added: added.filter((p) => !isAtOrUnder(p, path)),
      removed: removed.filter((p) => !isAtOrUnder(p, path)),
    });
  }

  onDidChange(cb: () => void) {
    this.listeners.add(cb);
    return { dispose: () => void this.listeners.delete(cb) };
  }

  private write(workspace: string | undefined, next: ContextChoice) {
    const before = this.choice(workspace);
    const same = (x: readonly string[], y: readonly string[]) =>
      x.length === y.length && x.every((p, i) => p === y[i]);
    if (same(before.added, next.added) && same(before.removed, next.removed)) {
      return;
    }
    this.choices.set(workspace, next);
    this.listeners.forEach((cb) => cb());
  }
}

export const PgAssistantContext = new AssistantContextStore();

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("entities/assistant-context/model/context", () => {
    const all = () => true;
    const choiceOf = (
      added: readonly string[],
      removed: readonly string[]
    ): ContextChoice => ({ added, removed });

    it("lists the tabs in order, then the added files", () => {
      expect(
        contextPathsWith(all)(
          ["src/lib.rs", "client/client.ts"],
          choiceOf(["tests/a.ts"], [])
        )
      ).toEqual(["src/lib.rs", "client/client.ts", "tests/a.ts"]);
    });

    it("lists a tab that was also added once", () => {
      expect(
        contextPathsWith(all)(["src/lib.rs"], choiceOf(["src/lib.rs"], []))
      ).toEqual(["src/lib.rs"]);
    });

    it("keeps a removed tab out while it stays open", () => {
      expect(
        contextPathsWith(all)(
          ["src/lib.rs", "b.ts"],
          choiceOf([], ["src/lib.rs"])
        )
      ).toEqual(["b.ts"]);
    });

    it("drops a file that no longer exists", () => {
      expect(
        contextPathsWith((p) => p !== "gone.ts")(
          ["src/lib.rs"],
          choiceOf(["gone.ts"], [])
        )
      ).toEqual(["src/lib.rs"]);
    });

    it("puts a re-added tab back at its tab position", () => {
      const store = new AssistantContextStore();
      store.remove("w", "a.ts");
      store.add("w", "a.ts");
      expect(
        contextPathsWith(all)(["a.ts", "b.ts"], store.choice("w"))
      ).toEqual(["a.ts", "b.ts"]);
    });

    it("keeps one workspace's choice out of another", () => {
      const store = new AssistantContextStore();
      store.add("w1", "x.ts");
      expect(store.choice("w2")).toEqual(choiceOf([], []));
    });

    it("keeps each workspace's choice while another is used", () => {
      const store = new AssistantContextStore();
      store.remove("a", "secret.rs");
      store.add("b", "x.ts");
      expect(store.choice("a")).toEqual(choiceOf([], ["secret.rs"]));
      expect(store.choice("b")).toEqual(choiceOf(["x.ts"], []));
    });

    it("forgets a deleted file, so a new file at its path is not added", () => {
      const store = new AssistantContextStore();
      store.add("w", "src/a.ts");
      store.add("w", "src/dir/b.ts");
      store.remove("w", "src/dir/c.ts");
      store.forget("w", "src/dir");
      expect(store.choice("w")).toEqual(choiceOf(["src/a.ts"], []));
    });

    it("tells no listener when nothing changed", () => {
      const store = new AssistantContextStore();
      store.add("w", "a.ts");
      const cb = vi.fn();
      store.onDidChange(cb);
      store.add("w", "a.ts");
      store.forget("w", "nothing.ts");
      expect(cb).not.toHaveBeenCalled();
    });

    it.each([
      ["src/lib.rs", "src/lib.rs"],
      ["./src/lib.rs", "src/lib.rs"],
      ["/src/lib.rs", "src/lib.rs"],
      ["src//lib.rs", "src/lib.rs"],
      ["src/./lib.rs", "src/lib.rs"],
      ["src/../src/lib.rs", "src/lib.rs"],
      ["src\\lib.rs", "src/lib.rs"],
      [" src/lib.rs ", "src/lib.rs"],
    ])("reads %s as %s", (path, expected) => {
      expect(normalizeProjectPath(path)).toBe(expected);
    });

    it("refuses a path that leaves the project", () => {
      expect(normalizeProjectPath("../outside.rs")).toBeUndefined();
      expect(normalizeProjectPath("src/../../x")).toBeUndefined();
      expect(normalizeProjectPath("")).toBeUndefined();
    });

    it("tells listeners about an add and a remove", () => {
      const store = new AssistantContextStore();
      const cb = vi.fn();
      const sub = store.onDidChange(cb);
      store.add("w", "a.ts");
      store.remove("w", "a.ts");
      expect(cb).toHaveBeenCalledTimes(2);
      sub.dispose();
      store.add("w", "a.ts");
      expect(cb).toHaveBeenCalledTimes(2);
    });
  });
}
