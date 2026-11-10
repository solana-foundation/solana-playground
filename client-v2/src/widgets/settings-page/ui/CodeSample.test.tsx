import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The hooks barrel pulls in the utils barrel, which reads a build-time global
// vitest lacks; the sample needs only the real `useRenderOnChange`
vi.mock("@/hooks", async () => ({
  useRenderOnChange: (await import("@/hooks/useRenderOnChange"))
    .useRenderOnChange,
}));

import CodeSample from "./CodeSample";

/** A code-font setting whose value the test changes, as `PgTheme` would */
const fontSetting = (initial: string) => {
  let font = initial;
  const listeners = new Set<(v: string) => void>();
  return {
    getValue: () => font,
    onChange: (cb: (v: string) => void) => {
      listeners.add(cb);
      return { dispose: () => listeners.delete(cb) };
    },
    set: (next: string) => {
      font = next;
      listeners.forEach((cb) => cb(next));
    },
  };
};

describe("CodeSample", () => {
  it("shows the sample in the code font picked, and follows a change", () => {
    const setting = fontSetting("Hack");
    render(<CodeSample setting={setting} />);
    const sample = () => screen.getByText(/pub fn initialize/);
    expect(sample().style.fontFamily).toBe("Hack");

    act(() => setting.set("Inconsolata"));

    expect(sample().style.fontFamily).toBe("Inconsolata");
  });
});
