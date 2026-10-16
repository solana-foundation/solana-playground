import { isTypingElsewhere } from "./focus";

const mount = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
};

describe("isTypingElsewhere", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is true for an input outside the editor", () => {
    const page = mount('<div id="editor"></div><input id="name" />');
    expect(
      isTypingElsewhere(
        page.querySelector("#editor")!,
        page.querySelector("#name")
      )
    ).toBe(true);
  });

  it("is false for a textarea inside the editor", () => {
    const page = mount('<div id="editor"><textarea></textarea></div>');
    expect(
      isTypingElsewhere(
        page.querySelector("#editor")!,
        page.querySelector("textarea")
      )
    ).toBe(false);
  });

  it("is false for a tree item, which takes no text", () => {
    const page = mount(
      '<div id="editor"></div><div role="treeitem" tabindex="0">lib.rs</div>'
    );
    expect(
      isTypingElsewhere(
        page.querySelector("#editor")!,
        page.querySelector('[role="treeitem"]')
      )
    ).toBe(false);
  });

  it("is false when nothing or the body has focus", () => {
    const page = mount('<div id="editor"></div>');
    const editor = page.querySelector("#editor")!;
    expect(isTypingElsewhere(editor, null)).toBe(false);
    expect(isTypingElsewhere(editor, document.body)).toBe(false);
  });

  it("is true for a contenteditable element outside the editor", () => {
    const page = mount(
      '<div id="editor"></div><div id="note" contenteditable="true"></div>'
    );
    const note = page.querySelector("#note")!;
    // jsdom does not implement isContentEditable.
    Object.defineProperty(note, "isContentEditable", { value: true });
    expect(isTypingElsewhere(page.querySelector("#editor")!, note)).toBe(true);
  });

  it("is false for a checkbox, which is not a text field", () => {
    const page = mount(
      '<div id="editor"></div><input id="box" type="checkbox" />'
    );
    expect(
      isTypingElsewhere(
        page.querySelector("#editor")!,
        page.querySelector("#box")
      )
    ).toBe(false);
  });

  it("is false for a select, which takes no text", () => {
    const page = mount(
      '<div id="editor"></div><select id="pick"><option>a</option></select>'
    );
    expect(
      isTypingElsewhere(
        page.querySelector("#editor")!,
        page.querySelector("#pick")
      )
    ).toBe(false);
  });

  it("reads the document's focus when no element is given", () => {
    const page = mount('<div id="editor"></div><input id="name" />');
    page.querySelector<HTMLInputElement>("#name")!.focus();
    expect(isTypingElsewhere(page.querySelector("#editor")!)).toBe(true);
  });
});
