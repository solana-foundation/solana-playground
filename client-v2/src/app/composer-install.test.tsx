import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Composer,
  ComposerInput,
  ComposerSend,
  ComposerToolbar,
} from "@/shared/ui/composer";

describe("composer: a controlled value", () => {
  it("enables Send for a value set by the product, not typed", () => {
    render(
      <Composer>
        <ComposerInput value="Why did my build fail?" onChange={() => {}} />
        <ComposerToolbar>
          <ComposerSend>Send</ComposerSend>
        </ComposerToolbar>
      </Composer>
    );
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      false
    );
  });

  it("disables Send again when the value is cleared", () => {
    const { rerender } = render(
      <Composer>
        <ComposerInput value="x" onChange={() => {}} />
        <ComposerSend />
      </Composer>
    );
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      false
    );
    rerender(
      <Composer>
        <ComposerInput value="" onChange={() => {}} />
        <ComposerSend />
      </Composer>
    );
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      true
    );
  });

  it("keeps Send disabled for a whitespace-only value", () => {
    render(
      <Composer>
        <ComposerInput value="   " onChange={() => {}} />
        <ComposerSend />
      </Composer>
    );
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      true
    );
  });
});

/**
 * A textarea whose content wraps by its width: `scrollHeight` is what a
 * one-line placeholder takes at the width the test sets
 */
const layOut = () => {
  const box = { width: 32 };
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => box.width
  );
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(() =>
    box.width < 100 ? 378 : 48
  );
  return box;
};

/** A ResizeObserver the test fires by hand */
const observeResizes = () => {
  const callbacks: Array<() => void> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  return () => act(() => callbacks.forEach((callback) => callback()));
};

describe("composer: the input's height follows its width", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("grows back to one line when a narrow column widens", () => {
    const box = layOut();
    const resize = observeResizes();
    render(
      <Composer>
        <ComposerInput value="" onChange={() => {}} />
      </Composer>
    );
    const input = screen.getByRole("textbox", { name: "Message" });
    expect(input.style.height).toBe("200px");

    box.width = 320;
    resize();
    expect(input.style.height).toBe("48px");
  });

  it("does not re-measure when only the height changed", () => {
    layOut();
    const resize = observeResizes();
    render(
      <Composer>
        <ComposerInput value="" onChange={() => {}} />
      </Composer>
    );
    const input = screen.getByRole("textbox", { name: "Message" });
    input.style.height = "120px";
    resize();
    expect(input.style.height).toBe("120px");
  });

  it("renders where there is no ResizeObserver", () => {
    layOut();
    vi.stubGlobal("ResizeObserver", undefined);
    render(
      <Composer>
        <ComposerInput value="" onChange={() => {}} />
      </Composer>
    );
    expect(screen.getByRole("textbox", { name: "Message" }).style.height).toBe(
      "200px"
    );
  });
});
