/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Doc, TutorialDefinition } from "@/entities/tutorial";

/**
 * The tutorial's files, by their path from the project root (`src/lib.rs`):
 * the finished program's (the intro's), then any other file a step creates,
 * in the order they first come. A `tests` folder is never part of a
 * tutorial's tree.
 */
export const tutorialFiles = (definition: TutorialDefinition): string[] => {
  const created = definition.steps.flatMap((step) =>
    step.beats.flatMap((beat) =>
      "writes" in beat && beat.writes && "create" in beat.writes
        ? [beat.writes.create]
        : []
    )
  );
  return [
    ...new Set([...Object.keys(definition.intro.files), ...created]),
  ].filter((path) => !isTests(path));
};

const isTests = (path: string) => path === "tests" || path.startsWith("tests/");

/**
 * The step, counted from 1, that first creates `path`; null for a file the
 * project starts with. The intro's files are the finished program, so they
 * say nothing about which file comes when.
 */
export const createdIn = (
  definition: TutorialDefinition,
  path: string
): number | null => {
  const at = definition.steps.findIndex((step) =>
    step.beats.some(
      (beat) =>
        "writes" in beat &&
        beat.writes &&
        "create" in beat.writes &&
        beat.writes.create === path
    )
  );
  return at === -1 ? null : at + 1;
};

/**
 * The head's tabs: the tutorial's files that exist, in the project's order,
 * so `lib.rs` always comes before `client.ts` whichever opened first.
 */
export const tabsOf = (files: string[], present: ReadonlySet<string>) =>
  files.filter((path) => present.has(path));

/** A doc page as the tree and the tabs list it: its Markdown file and its title */
export type DocTab = Pick<Doc, "file" | "title">;

/** The tree's last folder, holding the tutorial's doc pages */
const DOCS_FOLDER = "Docs";

/** One row of the tree: a folder's label, a file, or a doc page */
export type TreeRow =
  | { kind: "folder"; name: string; depth: number }
  | {
      kind: "doc";
      file: string;
      name: string;
      depth: number;
      /** The page is the tab in front */
      open: boolean;
    }
  | {
      kind: "file";
      path: string;
      name: string;
      depth: number;
      open: boolean;
      /** The live step's file carries a dot */
      live: boolean;
      /** Not there yet: the step that creates it, and the row is disabled */
      waiting: number | null;
    };

export interface TreeInput {
  files: string[];
  present: ReadonlySet<string>;
  open: string | null;
  live: string | null;
  createdIn: (path: string) => number | null;
  /** The doc pages, under the `Docs` folder; none for a tutorial without */
  docs: readonly DocTab[];
  /** The doc page in front, by file; none while a file is. While set, no
   * file row reads as open */
  openDoc?: string;
}

/**
 * The tree's rows: each folder in the order its first file comes (`src`,
 * then `client`), its files under it, then the files at the root, then the
 * `Docs` folder with the doc pages. One level deep, as a tutorial's project
 * is.
 */
export const treeRows = ({
  files,
  present,
  open,
  live,
  createdIn: stepOf,
  docs,
  openDoc,
}: TreeInput): TreeRow[] => {
  const file = (path: string, depth: number): TreeRow => {
    const there = present.has(path);
    return {
      kind: "file",
      path,
      name: path.split("/").pop() ?? path,
      depth,
      open: openDoc === undefined && path === open,
      live: there && path === live,
      waiting: there ? null : stepOf(path),
    };
  };
  const folders = [
    ...new Set(
      files.filter((f) => f.includes("/")).map((f) => f.split("/")[0])
    ),
  ];
  return [
    ...folders.flatMap((name) => [
      { kind: "folder", name, depth: 0 } as TreeRow,
      ...files.filter((f) => f.startsWith(`${name}/`)).map((f) => file(f, 1)),
    ]),
    ...files.filter((f) => !f.includes("/")).map((f) => file(f, 0)),
    ...(docs.length
      ? [
          { kind: "folder", name: DOCS_FOLDER, depth: 0 } as TreeRow,
          ...docs.map(
            (doc): TreeRow => ({
              kind: "doc",
              file: doc.file,
              name: doc.title,
              depth: 1,
              open: doc.file === openDoc,
            })
          ),
        ]
      : []),
  ];
};

/** Whether a row can take the focus and be opened */
export const pickable = (row: TreeRow) =>
  row.kind === "doc" || (row.kind === "file" && row.waiting === null);

/**
 * Where ↑ or ↓ moves the focus among the pickable rows, as an index into
 * `rows`: clamped at both ends, and from no focus to the first. Any other
 * key moves nothing (`null`).
 */
export const moveFocus = (
  rows: TreeRow[],
  at: number,
  key: string
): number | null => {
  if (key !== "ArrowDown" && key !== "ArrowUp") return null;
  const stops = rows.flatMap((row, i) => (pickable(row) ? [i] : []));
  if (stops.length === 0) return null;
  const here = stops.indexOf(at);
  if (here === -1) return stops[0];
  const next =
    key === "ArrowDown"
      ? Math.min(stops.length - 1, here + 1)
      : Math.max(0, here - 1);
  return stops[next];
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-workspace/model/tree", () => {
    const LIB = "src/lib.rs";
    const CLIENT = "client/client.ts";

    /** Hello Anchor's shape: lib.rs to start, client.ts made in step 3 */
    const definition = {
      // The intro's files are the finished program, client.ts included
      intro: {
        files: { [LIB]: "", [CLIENT]: "", "tests/anchor.test.ts": "" },
      },
      steps: [
        { beats: [{ kind: "say" }] },
        { beats: [] },
        { beats: [{ kind: "write", writes: { create: CLIENT } }] },
      ],
    } as unknown as TutorialDefinition;

    const rowsAt = (present: string[], open: string | null = LIB) =>
      treeRows({
        files: tutorialFiles(definition),
        present: new Set(present),
        open,
        live: LIB,
        createdIn: (path) => createdIn(definition, path),
        docs: [],
      });

    it("lists the starter files, then the created ones, and never tests", () => {
      expect(tutorialFiles(definition)).toEqual([LIB, CLIENT]);
    });

    it("names the step that creates a file, and none for a starter file", () => {
      expect(createdIn(definition, CLIENT)).toBe(3);
      expect(createdIn(definition, LIB)).toBeNull();
    });

    it("keeps the project's order in the tabs, whichever file came first", () => {
      expect(tabsOf([LIB, CLIENT], new Set([CLIENT, LIB]))).toEqual([
        LIB,
        CLIENT,
      ]);
      expect(tabsOf([LIB, CLIENT], new Set([LIB]))).toEqual([LIB]);
    });

    it("groups files under their folders in first-file order", () => {
      expect(
        rowsAt([LIB, CLIENT]).map((r) =>
          r.kind === "folder" ? `${r.name}/` : `  ${r.name}`
        )
      ).toEqual(["src/", "  lib.rs", "client/", "  client.ts"]);
    });

    it("marks the open file and the live step's file", () => {
      const lib = rowsAt([LIB, CLIENT]).find(
        (r) => r.kind === "file" && r.path === LIB
      );
      expect(lib).toMatchObject({ open: true, live: true, waiting: null });
    });

    it("disables a file a later step creates, with that step", () => {
      const client = rowsAt([LIB]).find(
        (r) => r.kind === "file" && r.path === CLIENT
      );
      expect(client).toMatchObject({ waiting: 3, live: false });
      expect(client && pickable(client)).toBe(false);
    });

    it("shows no Docs folder for a tutorial without doc pages", () => {
      expect(
        rowsAt([LIB]).some((r) => r.kind === "folder" && r.name === DOCS_FOLDER)
      ).toBe(false);
    });

    it("lists the doc pages last, under Docs, and marks the one in front", () => {
      const rows = treeRows({
        files: tutorialFiles(definition),
        present: new Set([LIB]),
        open: LIB,
        live: LIB,
        createdIn: (path) => createdIn(definition, path),
        docs: [
          { file: "idl.md", title: "IDL" },
          { file: "programs.md", title: "Programs" },
        ],
        openDoc: "idl.md",
      });
      expect(
        rows.map((r) =>
          r.kind === "folder" ? `${r.name}/` : `  ${r.name}${r.open ? "*" : ""}`
        )
      ).toEqual([
        "src/",
        "  lib.rs",
        "client/",
        "  client.ts",
        "Docs/",
        "  IDL*",
        "  Programs",
      ]);
      // The pages are stops for the arrows, after the files
      expect(moveFocus(rows, 1, "ArrowDown")).toBe(5);
    });

    it("moves the focus with the arrows, clamped, past folders and waiting files", () => {
      const rows = rowsAt([LIB, CLIENT]);
      expect(moveFocus(rows, -1, "ArrowDown")).toBe(1);
      expect(moveFocus(rows, 1, "ArrowDown")).toBe(3);
      expect(moveFocus(rows, 3, "ArrowDown")).toBe(3);
      expect(moveFocus(rows, 3, "ArrowUp")).toBe(1);
      expect(moveFocus(rows, 1, "ArrowUp")).toBe(1);
      expect(moveFocus(rows, 1, "Enter")).toBeNull();
      // client.ts not made yet: lib.rs is the only stop
      expect(moveFocus(rowsAt([LIB]), 1, "ArrowDown")).toBe(1);
    });
  });
}
