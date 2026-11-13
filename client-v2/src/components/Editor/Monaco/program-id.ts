import type * as monaco from "monaco-editor";

/** The declarations the build rewrites, so the buffer and the build agree */
const DECLARATION = {
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: `::` ends each `\w+` repetition and `\w` matches no `:`
  rust: /^(?:\w+::)*declare_id!\("(?<id>\w*)"\)/m,
  python: /^declare_id\((?<quote>["'])(?<id>\w*)\k<quote>\)/m,
};

/** Spaces over block comments, every offset kept; `//` fails the line anchor */
const withoutBlockComments = (content: string) =>
  content.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));

/** Where a declaration's match holds the id, quotes excluded */
const idRange = (match: RegExpExecArray | null) => {
  if (!match?.groups) return;
  const end = match.index + match[0].length - '")'.length;
  return { start: end - match.groups.id.length, end };
};

/**
 * Put the program id in the buffer's declaration. On the model rather than the
 * editor: the editor refuses edits while it is read only, as `useEditorLines`
 * holds it for a tutorial's whole build, and the id is Playground's to write
 * whoever may type.
 * The editor's change listener still fires, so autosave writes the new id.
 *
 * @param rangeOf where the file's form of the declaration holds the id
 * @returns the rewrite, for the program id, of the open file's buffer
 */
const rewriteProgramIdWith =
  (rangeOf: (content: string) => { start: number; end: number } | undefined) =>
  (id: string) =>
  (model: monaco.editor.ITextModel) => {
    const content = model.getValue();
    const range = rangeOf(content);
    if (!range || content.slice(range.start, range.end) === id) return;

    const from = model.getPositionAt(range.start);
    const to = model.getPositionAt(range.end);
    model.pushEditOperations(
      [],
      [
        {
          range: {
            startLineNumber: from.lineNumber,
            startColumn: from.column,
            endLineNumber: to.lineNumber,
            endColumn: to.column,
          },
          text: id,
        },
      ],
      // eslint-disable-next-line unicorn/no-null -- Monaco's "no selection to restore"
      () => null
    );
  };

/** Rewrite the id in a Rust file's `declare_id!` */
export const rewriteRustProgramId = rewriteProgramIdWith((content) =>
  idRange(DECLARATION.rust.exec(withoutBlockComments(content)))
);

/** Rewrite the id in a Seahorse file's `declare_id` */
export const rewritePythonProgramId = rewriteProgramIdWith((content) =>
  idRange(DECLARATION.python.exec(content))
);

if (import.meta.vitest) {
  const { afterEach, beforeAll, describe, expect, it } = import.meta.vitest;
  const NEW_ID = "NewProgram1111111111111111111111111111111111";
  const rust = (id: string) =>
    `use anchor_lang::prelude::*;\n\ndeclare_id!("${id}");\n`;

  describe("components/Editor/Monaco/program-id", () => {
    let live: typeof monaco;
    const made: monaco.IDisposable[] = [];
    const track = <T extends monaco.IDisposable>(thing: T) => {
      made.push(thing);
      return thing;
    };
    const model = (text: string) =>
      track(live.editor.createModel(text, "rust"));
    /** Held read only, as a tutorial holds it while its build act runs */
    const busyEditor = (text: monaco.editor.ITextModel) =>
      track(
        live.editor.create(document.createElement("div"), {
          model: text,
          readOnly: true,
        })
      );

    beforeAll(async () => {
      // What jsdom lacks and a real Monaco editor reads: `queryCommandSupported`
      // on load, a canvas context for its pixel ratio when one is created
      HTMLCanvasElement.prototype.getContext =
        (() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
      document.queryCommandSupported = () => false;
      // The core API alone: `editor.main` (what `monaco-editor` resolves to)
      // also loads every language and editor contribution, seconds of work
      // that these tests never use and that a busy machine stretched past the
      // hook's timeout during `yarn run check`
      live = (await import(
        "monaco-editor/esm/vs/editor/editor.api.js"
      )) as unknown as typeof monaco;
    });

    afterEach(() => {
      made.splice(0).forEach((thing) => thing.dispose());
    });

    it("rewrites the id while the editor is held read only", () => {
      const text = model(rust("Old"));
      const editor = busyEditor(text);
      // The way this used to go: Monaco refuses it, and the buffer keeps the old id
      expect(
        editor.executeEdits("test", [
          { range: new live.Range(1, 1, 1, 1), text: "x" },
        ])
      ).toBe(false);

      rewriteRustProgramId(NEW_ID)(text);

      expect(editor.getValue()).toBe(rust(NEW_ID));
    });

    it("tells the editor's listeners, so autosave writes the new id", () => {
      const text = model(rust("Old"));
      const editor = busyEditor(text);
      let saved = "";
      track(editor.onDidChangeModelContent(() => (saved = editor.getValue())));

      rewriteRustProgramId(NEW_ID)(text);

      expect(saved).toBe(rust(NEW_ID));
    });

    it("leaves a buffer already holding the id alone", () => {
      const text = model(rust(NEW_ID));
      const before = text.getAlternativeVersionId();

      rewriteRustProgramId(NEW_ID)(text);

      expect(text.getAlternativeVersionId()).toBe(before);
    });

    it("rewrites a declaration on the file's first line", () => {
      const text = model(`declare_id!("Old");\n`);

      rewriteRustProgramId(NEW_ID)(text);

      expect(text.getValue()).toBe(`declare_id!("${NEW_ID}");\n`);
    });

    it("rewrites Python's form", () => {
      const text = model(`declare_id('Old')\n`);

      rewritePythonProgramId(NEW_ID)(text);

      expect(text.getValue()).toBe(`declare_id('${NEW_ID}')\n`);
    });

    it("changes nothing in a file with no declaration", () => {
      const text = model("pub fn main() {}\n");

      rewriteRustProgramId(NEW_ID)(text);

      expect(text.getValue()).toBe("pub fn main() {}\n");
    });

    it("skips a commented-out declaration for the real one below it", () => {
      const text = model(`// declare_id!("Example")\ndeclare_id!("Old");\n`);

      rewriteRustProgramId(NEW_ID)(text);

      expect(text.getValue()).toBe(
        `// declare_id!("Example")\ndeclare_id!("${NEW_ID}");\n`
      );
    });

    it("skips a declaration inside a block comment", () => {
      const text = model(
        `/*\ndeclare_id!("Example");\n*/\ndeclare_id!("Old");\n`
      );

      rewriteRustProgramId(NEW_ID)(text);

      expect(text.getValue()).toBe(
        `/*\ndeclare_id!("Example");\n*/\ndeclare_id!("${NEW_ID}");\n`
      );
    });

    it("rewrites a declaration written with its crate path", () => {
      const text = model(`anchor_lang::declare_id!("Old");\n`);

      rewriteRustProgramId(NEW_ID)(text);

      expect(text.getValue()).toBe(`anchor_lang::declare_id!("${NEW_ID}");\n`);
    });

    it("changes nothing when the name is only mentioned, not declared", () => {
      const source = `// declare_id! holds the address "here"\n`;
      const text = model(source);

      rewriteRustProgramId(NEW_ID)(text);

      expect(text.getValue()).toBe(source);
    });
  });
}
