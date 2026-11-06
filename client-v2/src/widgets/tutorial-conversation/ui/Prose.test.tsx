import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PhoneLayoutContext } from "./phone";
import { noStop, Prose, textOf } from "./Prose";

const draw = (text: string) => render(<Prose text={text} />).container;

describe("Prose", () => {
  it("keeps the text whole, with each tick pair as a chip", () => {
    const box = draw("Yours is `hello`, in `#[program]`.");
    expect(box.textContent).toBe("Yours is hello, in #[program].");
    expect(
      Array.from(box.querySelectorAll("code")).map((c) => c.textContent)
    ).toEqual(["hello", "#[program]"]);
  });

  it("glues a stop after a chip to it in one unbreakable run, and only once", () => {
    const box = draw("Use `msg!`). Then `ok`");
    const code = box.querySelector("code");
    const run = code?.parentElement;
    expect(run?.className).toContain("whitespace-nowrap");
    expect(run?.textContent).toBe("msg!).");
    expect(box.textContent).toBe("Use msg!). Then ok");
  });

  it("leaves a chip with no stop after it unwrapped", () => {
    const box = draw("`a` and `b`");
    expect(box.textContent).toBe("a and b");
    expect(box.querySelectorAll("span.whitespace-nowrap")).toHaveLength(0);
  });
});

describe("textOf", () => {
  it("reads a definition's phone variant on the phone, and its text elsewhere", () => {
    expect(textOf({ text: "a", phone: "b" }, true)).toBe("b");
    expect(textOf({ text: "a", phone: "b" }, false)).toBe("a");
    expect(textOf("a", true)).toBe("a");
  });

  it("draws the phone variant inside the phone layout", () => {
    const box = render(
      <PhoneLayoutContext.Provider value={{ phone: true, tablet: false }}>
        <Prose text={{ text: "Type `x` here", phone: "Tap `x`" }} />
      </PhoneLayoutContext.Provider>
    ).container;
    expect(box.textContent).toBe("Tap x");
    expect(noStop({ text: "Desk.", phone: "Phone." }, true)).toBe("Phone");
  });
});

describe("noStop", () => {
  it("drops one closing period and nothing else", () => {
    expect(noStop("Your program compiles.", false)).toBe(
      "Your program compiles"
    );
    expect(noStop("Ready?", false)).toBe("Ready?");
    expect(noStop("And then...", false)).toBe("And then...");
    expect(noStop("No period", false)).toBe("No period");
  });
});
