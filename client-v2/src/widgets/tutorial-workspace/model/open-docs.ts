import { createLogger } from "@/shared/lib/logger";

const log = createLogger("tutorial-workspace:open-docs");

/**
 * The open doc tabs of each tutorial, by name, as their Markdown files. Kept
 * on the device beside the docked trees: `.workspace/metadata.json` holds
 * file tabs only, and the explorer reopens every entry there as a file
 */
const DOCS_KEY = "tutorial-workspace.docs";
/** The doc page in front in each tutorial, by name; none for its code */
const FRONT_KEY = "tutorial-workspace.front-doc";

/** What a stored value is, for the log: `typeof` calls `null` an object */
const shapeOf = (value: unknown) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

/** One store's map by tutorial; an unreadable store reads as empty */
const readStore = (key: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(key);
    parsed = raw ? JSON.parse(raw) : {};
  } catch (error) {
    // A broken or blocked store reads as nothing saved; the tree still has the docs
    log.warn("could not read the doc tabs", { context: { key, error } });
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    // Not this key's shape: read as empty, and the next write replaces it
    log.warn("the doc tabs are not a map by tutorial", {
      context: { key, kind: shapeOf(parsed) },
    });
    return {};
  }
  return parsed as Record<string, unknown>;
};

/**
 * Saves one tutorial's entry in a store, leaving the others'; none removes
 * it. A store that could not be read is replaced, losing what it held
 */
const writeStoreFor =
  (key: string) => (name: string, value: string[] | string | undefined) => {
    const all = readStore(key);
    if (value === undefined || value.length === 0) delete all[name];
    else all[name] = value;
    try {
      localStorage.setItem(key, JSON.stringify(all));
    } catch (error) {
      // The tabs still hold for the visit; only the next one forgets them
      log.warn("could not save the doc tabs", { context: { key, error } });
    }
  };

/** Every tutorial's open doc tabs; an unreadable store reads as none open */
export const readOpenDocs = (): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(readStore(DOCS_KEY)).map(([name, files]) => [
      name,
      Array.isArray(files)
        ? files.filter((f): f is string => typeof f === "string")
        : [],
    ])
  );

/** Saves one tutorial's open doc tabs; none open removes its entry */
export const writeOpenDocs: (name: string, files: string[]) => void =
  writeStoreFor(DOCS_KEY);

/** The doc page a tutorial had in front, if any; its code otherwise */
export const readFrontDoc = (name: string): string | undefined => {
  const file = readStore(FRONT_KEY)[name];
  return typeof file === "string" ? file : undefined;
};

/** Saves the doc page in front of a tutorial's code; none for the code */
export const writeFrontDoc: (name: string, file: string | undefined) => void =
  writeStoreFor(FRONT_KEY);

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach } = import.meta.vitest;

  describe("widgets/tutorial-workspace/model/open-docs", () => {
    beforeEach(() => localStorage.clear());

    it("reads each tutorial's files, dropping what is not a file name", () => {
      localStorage.setItem(
        DOCS_KEY,
        JSON.stringify({ a: ["x.md", 3], b: "y.md" })
      );
      expect(readOpenDocs()).toEqual({ a: ["x.md"], b: [] });
    });

    it("reads a store of another shape, or broken, as none open", () => {
      localStorage.setItem(DOCS_KEY, "[1]");
      expect(readOpenDocs()).toEqual({});
      localStorage.setItem(DOCS_KEY, "{bad");
      expect(readOpenDocs()).toEqual({});
    });

    it("saves one tutorial's tabs and removes its entry once none is open", () => {
      writeOpenDocs("a", ["idl.md"]);
      writeOpenDocs("b", ["programs.md"]);
      writeOpenDocs("a", []);
      expect(readOpenDocs()).toEqual({ b: ["programs.md"] });
    });

    it("saves the page in front by tutorial, and forgets it when the code is", () => {
      writeFrontDoc("a", "idl.md");
      writeFrontDoc("b", "programs.md");
      writeFrontDoc("a", undefined);
      expect(readFrontDoc("a")).toBeUndefined();
      expect(readFrontDoc("b")).toBe("programs.md");
    });

    it("reads a front page that is not a file name as none", () => {
      localStorage.setItem(FRONT_KEY, JSON.stringify({ a: 3 }));
      expect(readFrontDoc("a")).toBeUndefined();
    });
  });
}
