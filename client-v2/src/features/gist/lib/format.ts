/**
 * The gist format, version 1: how a project's tree goes into a gist, which
 * holds only flat file names, and back. Export and import both go through
 * here, so the two directions cannot drift. See the `gist-sharing` spec.
 */
import { PgLanguage } from "../../../utils/language";

import { MANIFEST_NAME, MAX_GIST_BYTES, MAX_GIST_FILES } from "../config.mjs";

export { MANIFEST_NAME, MAX_GIST_BYTES, MAX_GIST_FILES };

const MANIFEST_VERSION = 1;

/** A gist's files as GitHub's API names them, content resolved */
export type GistFiles = Record<string, { content: string }>;

export type GistFormatReason =
  | "invalid-manifest"
  | "unsupported-version"
  | "unsafe-path"
  | "missing-file"
  | "no-supported-files";

/** A gist this format cannot read; nothing of it should be written */
export class GistFormatError extends Error {
  constructor(readonly reason: GistFormatReason, message: string) {
    super(message);
    this.name = "GistFormatError";
  }
}

interface Manifest {
  version: typeof MANIFEST_VERSION;
  name: string;
  /** Gist file name to project path */
  files: Record<string, string>;
  /** Paths of empty files: GitHub refuses a gist file with no content */
  empty: string[];
}

/**
 * Whether a project path may leave the browser in a gist, and so whether an
 * import may write it.
 *
 * `.workspace/` holds the program keypair (`program-info.json`), the open
 * tabs and a lesson's progress; the root `.tutorial.json` marks a workspace as
 * a lesson. None of it belongs to the code being shared, and the keypair must
 * never be published.
 *
 * @param path relative to the project root, without a leading `/`
 */
export const isExportablePath = (path: string) =>
  path !== ".tutorial.json" &&
  path !== ".workspace" &&
  !path.startsWith(".workspace/");

/** A path an import may write: relative, inside the project, exportable */
const isSafePath = (path: string) =>
  typeof path === "string" &&
  !path.startsWith("/") &&
  path
    .split("/")
    .every(
      (segment) => segment !== "" && segment !== "." && segment !== ".."
    ) &&
  isExportablePath(path);

/** `name-2.ext` for `name.ext`: the counter goes before the last extension */
const withCounter = (name: string, n: number) => {
  const dot = name.lastIndexOf(".");
  // A leading dot (`.keep`) starts the name, it is not an extension
  if (dot <= 0) return `${name}-${n}`;
  return `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
};

/**
 * Flatten a project into gist files plus the manifest that reverses it.
 *
 * Names are the path with `/` replaced by `__`, readable on the gist's page;
 * a name already taken (or the manifest's) gets a counter. Paths are taken in
 * sorted order so the same project always gets the same names.
 *
 * @param project files keyed by path relative to the project root
 */
export const toGistFiles = (project: {
  name: string;
  files: Record<string, string>;
}): GistFiles => {
  // Maps, turned into objects at the end: `Object.fromEntries` makes own
  // keys, where an assignment to `__proto__` would set the prototype and
  // lose a file of that name
  const gist = new Map<string, { content: string }>();
  const named = new Map<string, string>();
  const empty: string[] = [];
  const taken = new Set([MANIFEST_NAME]);

  const paths = Object.keys(project.files).filter(isExportablePath).sort();
  for (const path of paths) {
    const content = project.files[path];
    if (content === "") {
      empty.push(path);
      continue;
    }

    const flat = path.replaceAll("/", "__");
    let name = flat;
    for (let n = 2; taken.has(name); n++) name = withCounter(flat, n);
    taken.add(name);

    gist.set(name, { content });
    named.set(name, path);
  }

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    name: project.name,
    files: Object.fromEntries(named),
    empty,
  };
  gist.set(MANIFEST_NAME, { content: JSON.stringify(manifest, null, 2) });
  return Object.fromEntries(gist);
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => typeof v === "string");

/** The manifest, checked field by field: it is whatever the gist's owner wrote */
const parseManifest = (content: string): Manifest => {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new GistFormatError(
      "invalid-manifest",
      `${MANIFEST_NAME} is not valid JSON.`
    );
  }
  if (!raw || typeof raw !== "object") {
    throw new GistFormatError(
      "invalid-manifest",
      `${MANIFEST_NAME} is not an object.`
    );
  }

  const { version, name, files, empty = [] } = raw as Record<string, unknown>;
  if (version !== MANIFEST_VERSION) {
    throw new GistFormatError(
      "unsupported-version",
      `This gist was made by a newer Playground (format ${String(version)}).`
    );
  }
  if (
    typeof name !== "string" ||
    !isStringRecord(files) ||
    !Array.isArray(empty) ||
    !empty.every((path) => typeof path === "string")
  ) {
    throw new GistFormatError(
      "invalid-manifest",
      `${MANIFEST_NAME} does not have the expected fields.`
    );
  }
  return { version, name, files, empty };
};

/** Where a file of a hand-made gist goes, or `null` to leave it out */
const looseTarget = (
  name: string,
  isSupported: (path: string) => boolean
): string | null => {
  if (!isSupported(name)) return null;
  if (/\.(test|spec)\.[jt]sx?$/.test(name)) return `tests/${name}`;
  if (/\.(rs|py)$/.test(name)) return `src/${name}`;
  if (/\.[jt]sx?$/.test(name)) return `client/${name}`;
  return name;
};

/**
 * Read a gist back into a project.
 *
 * With a manifest, the files go exactly where it says, after every path has
 * been checked: a manifest is input from whoever made the gist. Without one
 * (a gist made by hand) each file is placed by its kind, as a repository
 * import would. Throws {@link GistFormatError}; on a throw nothing is meant to
 * be written.
 *
 * @param files the gist's files, with truncated contents already fetched
 * @param options.isSupported whether the Playground can open a file; the
 * default asks `PgLanguage`, which the app registers at startup
 */
export const fromGistFiles = (
  files: GistFiles,
  options: { isSupported?: (path: string) => boolean } = {}
): {
  name: string | null;
  files: Record<string, string>;
  layout: "manifest" | "loose";
} => {
  const manifestFile = files[MANIFEST_NAME];
  if (!manifestFile) {
    const isSupported =
      options.isSupported ?? ((path) => !!PgLanguage.getFromPath(path));
    const placed = new Map<string, string>();
    for (const [name, { content }] of Object.entries(files)) {
      const target = looseTarget(name, isSupported);
      if (target) placed.set(target, content);
    }
    if (!placed.size) {
      throw new GistFormatError(
        "no-supported-files",
        "This gist holds no file the Playground can open."
      );
    }
    return { name: null, files: Object.fromEntries(placed), layout: "loose" };
  }

  const manifest = parseManifest(manifestFile.content);
  const placed = new Map<string, string>();
  const place = (path: string, content: string) => {
    if (!isSafePath(path)) {
      throw new GistFormatError("unsafe-path", `Refusing to write ${path}.`);
    }
    // A second entry for one path would overwrite the first, silently
    if (placed.has(path)) {
      throw new GistFormatError(
        "invalid-manifest",
        `${MANIFEST_NAME} lists ${path} twice.`
      );
    }
    placed.set(path, content);
  };
  for (const [name, path] of Object.entries(manifest.files)) {
    // Own files only: `files.toString` is not a file of the gist
    const file = Object.hasOwn(files, name) ? files[name] : undefined;
    if (typeof file?.content !== "string") {
      throw new GistFormatError(
        "missing-file",
        `The gist has no file ${name}, which its manifest lists.`
      );
    }
    place(path, file.content);
  }
  for (const path of manifest.empty) place(path, "");
  return {
    name: manifest.name,
    files: Object.fromEntries(placed),
    layout: "manifest",
  };
};

/**
 * What a gist costs against {@link MAX_GIST_BYTES} and {@link MAX_GIST_FILES}:
 * UTF-8 bytes of every file, the manifest included; files without it.
 */
export const measureGist = (files: GistFiles) => {
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const { content } of Object.values(files)) {
    bytes += encoder.encode(content).length;
  }
  return {
    bytes,
    files: Object.keys(files).filter((name) => name !== MANIFEST_NAME).length,
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/gist/lib/format", () => {
    const manifestOf = (gist: GistFiles) =>
      JSON.parse(gist[MANIFEST_NAME].content);

    const reasonOf = (run: () => unknown) => {
      try {
        run();
      } catch (e) {
        return e instanceof GistFormatError ? e.reason : `other: ${e}`;
      }
      return "no error";
    };

    const withManifest = (manifest: unknown, files: GistFiles = {}) => {
      const gist: GistFiles = {
        [MANIFEST_NAME]: { content: JSON.stringify(manifest) },
      };
      for (const [name, file] of Object.entries(files)) gist[name] = file;
      return gist;
    };

    it("round trip keeps paths, contents and name", () => {
      const files = {
        "src/lib.rs": "use anchor_lang::prelude::*;",
        "client/client.ts": "console.log('hi');",
        "tests/anchor.test.ts": "describe('x', () => {});",
        "tests/.keep": "",
        "README.md": "# Счётчик\n",
      };

      const back = fromGistFiles(toGistFiles({ name: "counter", files }));

      expect(back).toEqual({ name: "counter", files, layout: "manifest" });
    });

    it("nested paths become __ names", () => {
      const gist = toGistFiles({
        name: "p",
        files: { "src/lib.rs": "a", "client/client.ts": "b" },
      });

      expect(Object.keys(gist).sort()).toEqual([
        MANIFEST_NAME,
        "client__client.ts",
        "src__lib.rs",
      ]);
      expect(gist["src__lib.rs"].content).toBe("a");
    });

    it("a clash gets -2 before the last extension, the same way every time", () => {
      const files = {
        "src__a.test.rs": "root",
        "src/a.test.rs": "nested",
        Makefile: "m",
        "x/Makefile": "n",
      };
      // Deliberately listed in another order: names follow path order
      const reordered = {
        "x/Makefile": "n",
        "src/a.test.rs": "nested",
        Makefile: "m",
        "src__a.test.rs": "root",
      };

      const gist = toGistFiles({ name: "p", files });

      expect(manifestOf(gist).files).toEqual({
        Makefile: "Makefile",
        "src__a.test.rs": "src/a.test.rs",
        "src__a.test-2.rs": "src__a.test.rs",
        x__Makefile: "x/Makefile",
      });
      expect(toGistFiles({ name: "p", files: reordered })).toEqual(gist);
    });

    it("a project's own .playground.json survives", () => {
      const files = { ".playground.json": "{}", "src/lib.rs": "x" };

      const gist = toGistFiles({ name: "p", files });

      expect(gist[".playground-2.json"].content).toBe("{}");
      expect(fromGistFiles(gist).files).toEqual(files);
    });

    it("empty files go to the manifest only", () => {
      const gist = toGistFiles({
        name: "p",
        files: { "tests/.keep": "", "src/lib.rs": "x" },
      });

      expect(Object.keys(gist).sort()).toEqual([MANIFEST_NAME, "src__lib.rs"]);
      expect(manifestOf(gist).empty).toEqual(["tests/.keep"]);
    });

    it("never exports .workspace or the root .tutorial.json", () => {
      expect(isExportablePath(".workspace/program-info.json")).toBe(false);
      expect(isExportablePath(".workspace/metadata.json")).toBe(false);
      expect(isExportablePath(".tutorial.json")).toBe(false);
      expect(isExportablePath("src/.tutorial.json")).toBe(true);
      expect(isExportablePath("src/lib.rs")).toBe(true);

      const gist = toGistFiles({
        name: "p",
        files: {
          ".workspace/program-info.json": '{"kp":[1,2,3]}',
          ".tutorial.json": "{}",
          "src/lib.rs": "x",
        },
      });

      expect(Object.values(manifestOf(gist).files)).toEqual(["src/lib.rs"]);
      expect(JSON.stringify(gist)).not.toContain("kp");
    });

    it("rejects a manifest that is not JSON of the v1 shape", () => {
      const broken: GistFiles = { [MANIFEST_NAME]: { content: "{" } };

      expect(reasonOf(() => fromGistFiles(broken))).toBe("invalid-manifest");
      expect(
        reasonOf(() =>
          fromGistFiles(withManifest({ version: 1, name: "p", files: [] }))
        )
      ).toBe("invalid-manifest");
      expect(
        reasonOf(() =>
          fromGistFiles(
            withManifest({ version: 1, name: "p", files: {}, empty: "x" })
          )
        )
      ).toBe("invalid-manifest");
    });

    it("rejects another manifest version", () => {
      expect(
        reasonOf(() =>
          fromGistFiles(withManifest({ version: 2, name: "p", files: {} }))
        )
      ).toBe("unsupported-version");
    });

    it.each([
      "../../etc/x.rs",
      "/etc/x.rs",
      "src//x.rs",
      "src/./x.rs",
      ".workspace/program-info.json",
      ".tutorial.json",
    ])("rejects the unsafe path %s", (path) => {
      const gist = withManifest(
        { version: 1, name: "p", files: { "x.rs": path }, empty: [] },
        { "x.rs": { content: "x" } }
      );

      expect(reasonOf(() => fromGistFiles(gist))).toBe("unsafe-path");
    });

    it("rejects an unsafe empty-file path", () => {
      const gist = withManifest({
        version: 1,
        name: "p",
        files: {},
        empty: ["../x"],
      });

      expect(reasonOf(() => fromGistFiles(gist))).toBe("unsafe-path");
    });

    it("rejects a manifest entry whose file is missing", () => {
      const gist = withManifest({
        version: 1,
        name: "p",
        files: { "src__lib.rs": "src/lib.rs" },
        empty: [],
      });

      expect(reasonOf(() => fromGistFiles(gist))).toBe("missing-file");
    });

    it("rejects a manifest that writes one path twice", () => {
      const twice = withManifest(
        {
          version: 1,
          name: "p",
          files: { "a.rs": "src/lib.rs", "b.rs": "src/lib.rs" },
          empty: [],
        },
        { "a.rs": { content: "a" }, "b.rs": { content: "b" } }
      );
      const emptied = withManifest(
        {
          version: 1,
          name: "p",
          files: { "a.rs": "src/lib.rs" },
          empty: ["src/lib.rs"],
        },
        { "a.rs": { content: "a" } }
      );

      expect(reasonOf(() => fromGistFiles(twice))).toBe("invalid-manifest");
      expect(reasonOf(() => fromGistFiles(emptied))).toBe("invalid-manifest");
    });

    it("reads only the gist's own files, never an inherited one", () => {
      const gist = withManifest({
        version: 1,
        name: "p",
        files: { __proto__: "src/x.rs", toString: "src/y.rs" },
        empty: [],
      });
      // `JSON.stringify` drops a `__proto__` set by a literal; write it raw
      gist[MANIFEST_NAME] = {
        content:
          '{"version":1,"name":"p","files":{"__proto__":"src/x.rs","toString":"src/y.rs"},"empty":[]}',
      };

      expect(reasonOf(() => fromGistFiles(gist))).toBe("missing-file");
    });

    it("round-trips a file named __proto__", () => {
      // An own key, as a store read would make it; a literal sets the prototype
      const files: Record<string, string> = JSON.parse(
        '{"__proto__":"a","src/lib.rs":"b"}'
      );

      const back = fromGistFiles(toGistFiles({ name: "p", files }));

      expect(Object.entries(back.files)).toEqual(Object.entries(files));
    });

    it("places a hand-made gist's files by kind", () => {
      const supported = (path: string) => /\.(rs|py|ts|js|json)$/.test(path);

      const back = fromGistFiles(
        {
          "lib.rs": { content: "a" },
          "seahorse.py": { content: "b" },
          "app.test.ts": { content: "c" },
          "app.spec.js": { content: "d" },
          "client.ts": { content: "e" },
          "config.json": { content: "f" },
          "notes.docx": { content: "g" },
        },
        { isSupported: supported }
      );

      expect(back).toEqual({
        name: null,
        layout: "loose",
        files: {
          "src/lib.rs": "a",
          "src/seahorse.py": "b",
          "tests/app.test.ts": "c",
          "tests/app.spec.js": "d",
          "client/client.ts": "e",
          "config.json": "f",
        },
      });
    });

    it("fails a hand-made gist with nothing supported", () => {
      expect(
        reasonOf(() =>
          fromGistFiles(
            { "notes.docx": { content: "g" } },
            { isSupported: () => false }
          )
        )
      ).toBe("no-supported-files");
    });

    it("measures UTF-8 bytes and leaves the manifest out of the file count", () => {
      const gist = toGistFiles({
        name: "p",
        files: { "a.rs": "é", "b.rs": "x" },
      });

      const size = measureGist(gist);

      expect(size.files).toBe(2);
      expect(size.bytes).toBe(
        3 + new TextEncoder().encode(gist[MANIFEST_NAME].content).length
      );
    });
  });
}
