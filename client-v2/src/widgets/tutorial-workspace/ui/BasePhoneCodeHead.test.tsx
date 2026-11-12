/* eslint-disable unicorn/no-null -- the explorer names no open file with null */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import BasePhoneCodeHead from "./BasePhoneCodeHead";

describe("BasePhoneCodeHead", () => {
  it("names the open file by its base name and opens the files on a tap", async () => {
    const onFiles = vi.fn();
    render(
      <BasePhoneCodeHead
        file="src/lib.rs"
        onFiles={onFiles}
        call={<button type="button">Call</button>}
      />
    );
    const files = screen.getByRole("button", { name: "Files" });
    expect(files.textContent).toContain("lib.rs");
    expect(files.textContent).not.toContain("src/");
    await userEvent.click(files);
    expect(onFiles).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Call" })).toBeTruthy();
  });

  it("names the doc page in front in place of the file", () => {
    render(
      <BasePhoneCodeHead
        file="src/lib.rs"
        doc="IDL"
        onFiles={vi.fn()}
        call={undefined}
      />
    );
    expect(screen.getByRole("button", { name: "Files" }).textContent).toContain(
      "IDL"
    );
    expect(
      screen.getByTestId("tutorial-phone-code-head").textContent
    ).not.toContain("lib.rs");
  });

  it("gives the switcher a fingertip's height", () => {
    render(
      <BasePhoneCodeHead file={null} onFiles={vi.fn()} call={undefined} />
    );
    expect(screen.getByRole("button", { name: "Files" }).classList).toContain(
      "h-11"
    );
  });
});
