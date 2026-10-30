// The Build stage drawn from props: which surface says what, which action
// is the brand one, and that the action row closes every surface.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BaseBuild from "./BaseBuild";
import type { BaseBuildProps, BuildSurfaceView } from "./BaseBuild";
import type { DiagnosticView } from "./build-view";

/** A type error whose Explain and Fix send `explain <name>` and `fix <name>` */
const typeError = (name: string, label: string | null): DiagnosticView => ({
  code: "E0308",
  title: "Wrong type",
  explanation: "The value is a different type.",
  label,
  file: "src/lib.rs",
  lines: [
    { num: 4, text: "fn f() {", failing: false },
    { num: 5, text: '    let x: u32 = "no";', failing: true },
    { num: 6, text: "}", failing: false },
  ],
  excerpt: "",
  prompts: { explain: `explain ${name}`, fix: `fix ${name}` },
});

const RAW = "error[E0308]: mismatched types\nwarning: unused";

/** The failed surface with its errors, counted */
const failed = (diagnostics: DiagnosticView[]): BuildSurfaceView => ({
  kind: "failed",
  diagnostics,
  errorCount: diagnostics.length,
  raw: RAW,
});

/** Every prop, named; each test passes the surface it is about */
const props = (
  surface: BuildSurfaceView,
  building = false,
  slow = false
): BaseBuildProps => ({
  surface,
  building,
  slow,
  host: "api.solpg.io",
  serverUrl: "https://api.solpg.io",
  ms: 2900,
  onBuild: vi.fn(() => Promise.resolve()),
  onContinue: vi.fn(),
  onExport: vi.fn(() => Promise.resolve()),
  onAsk: vi.fn(),
  onOpenFile: vi.fn(),
  idlActions: null,
});

const brandButtons = (container: HTMLElement) =>
  container.querySelectorAll('[data-slot="brand-button"]');

/** The action row is the stage's last element, so a phone can pin it */
const lastIsActions = (container: HTMLElement) =>
  container
    .querySelector('[data-slot="stage-empty"]')
    ?.lastElementChild?.getAttribute("data-slot");

describe("BaseBuild", () => {
  /** The prototype's empty stage: no icon tile, the brand pill to press */
  it("offers a first build as the brand pill", async () => {
    const p = props({ kind: "empty" });
    const { container } = render(<BaseBuild {...p} />);

    expect(
      screen.getByRole("heading", { name: "Nothing built yet" })
    ).toBeTruthy();
    // Async: Build is an AsyncButton, which settles once `onBuild` resolves
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Build" }));
    });
    expect(p.onBuild).toHaveBeenCalled();
    expect(brandButtons(container)).toHaveLength(1);
    expect(
      container.querySelector('[data-slot="stage-empty-media"]')
    ).toBeNull();
    expect(lastIsActions(container)).toBe("stage-empty-actions");
  });

  it("says where a first build runs while it runs", () => {
    render(<BaseBuild {...props({ kind: "empty" }, true)} />);

    expect(screen.getByRole("heading", { name: "Building…" })).toBeTruthy();
    expect(screen.getByText(/Compiling on api\.solpg\.io/)).toBeTruthy();
    const busy = screen.getByRole("button", { name: /Building/ });
    expect(busy).toHaveProperty("disabled", true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
  });

  it("offers Deploy as the one brand button after a build", () => {
    const p = props({ kind: "succeeded" });
    const { container } = render(<BaseBuild {...p} />);

    expect(
      screen.getByRole("heading", { name: "Build succeeded" })
    ).toBeTruthy();
    expect(screen.getByText("Built in 2.9 s")).toBeTruthy();
    expect(brandButtons(container)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Deploy" }));
    expect(p.onContinue).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Export project" })).toBeTruthy();
    expect(lastIsActions(container)).toBe("stage-empty-actions");
  });

  it("says a build that never reached the compiler did not start (BUILD-04)", async () => {
    const p = props({
      kind: "unreached",
      failure: { kind: "no-answer", message: "Failed to fetch" },
    });
    render(<BaseBuild {...p} />);

    expect(
      screen.getByRole("heading", { name: "Build did not start" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "The Playground server did not answer. Your code is unchanged."
      )
    ).toBeTruthy();
    // The server and the raw error wait behind Show details
    expect(screen.queryByText(/api\.solpg\.io/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(
      screen.getByText(/Build server: https:\/\/api\.solpg\.io/)
    ).toBeTruthy();
    expect(screen.getByText(/Failed to fetch/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(p.onBuild).toHaveBeenCalled();
  });

  // A server that replied with an error, or any other failure: not BUILD-04
  it("says it could not build when the server did answer (ANY-00)", () => {
    const p = props({
      kind: "unreached",
      failure: { kind: "other", message: "Server request failed: boom" },
    });
    render(<BaseBuild {...p} />);

    expect(
      screen.getByRole("heading", { name: "Could not build" })
    ).toBeTruthy();
    expect(screen.getByText("The full log has the details.")).toBeTruthy();
    expect(screen.queryByText(/did not answer/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText(/Server request failed: boom/)).toBeTruthy();
  });

  it("says a failed build happened before the reload", () => {
    const { container } = render(
      <BaseBuild {...props({ kind: "restored", failed: true })} />
    );

    expect(
      screen.getByRole("heading", { name: "Last build failed" })
    ).toBeTruthy();
    expect(brandButtons(container)).toHaveLength(0);
  });

  it("offers Deploy over a build from before the reload", () => {
    render(<BaseBuild {...props({ kind: "restored", failed: false })} />);

    expect(screen.getByRole("heading", { name: "Built earlier" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue to Deploy" })
    ).toBeTruthy();
  });

  it("marks the faulty line of a failed build", async () => {
    const p = props(failed([typeError("it", "expected u32")]));
    const { container } = render(<BaseBuild {...p} />);

    expect(screen.getByRole("heading", { name: "Build failed" })).toBeTruthy();
    expect(screen.getByText("1 error · 2.9 s · api.solpg.io")).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="diagnostic"]')).toHaveLength(
      1
    );
    expect(
      container.querySelector('[data-slot="diagnostic-code"]')?.textContent
    ).toBe("E0308");
    const fault = container.querySelector("[data-fault]");
    expect(fault?.textContent).toContain("let x");
    expect(fault?.textContent).toContain("expected u32");

    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(p.onAsk).toHaveBeenCalledWith("explain it");
    fireEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(p.onAsk).toHaveBeenCalledWith("fix it");
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(p.onOpenFile).toHaveBeenCalledWith("src/lib.rs");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(p.onBuild).toHaveBeenCalled();
    expect(lastIsActions(container)).toBe("stage-empty-actions");
  });

  /** rustc prints no text after the carets for some errors */
  it("marks the faulty line when rustc gave it no label", () => {
    const { container } = render(
      <BaseBuild {...props(failed([typeError("it", null)]))} />
    );

    const fault = container.querySelector("[data-fault]");
    expect(fault?.textContent).toContain("let x");
    expect(fault?.textContent).toContain("Wrong type");
  });

  it("keeps the brand button for the first error only", () => {
    const { container } = render(
      <BaseBuild
        {...props(failed([typeError("first", "a"), typeError("second", "b")]))}
      />
    );

    expect(brandButtons(container)).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Explain" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Fix" })).toHaveLength(2);
    // The brand one is the first card's Explain (Spec 08 BUILD-01)
    expect(brandButtons(container)[0].textContent).toBe("Explain");
  });

  it("shows rustc's excerpt when the source cannot be read", () => {
    const view: DiagnosticView = {
      code: "E0308",
      title: "Wrong type",
      explanation: "",
      label: null,
      file: null,
      lines: null,
      excerpt: "5 | let x: u32 = 1;",
      prompts: { explain: "explain", fix: "fix" },
    };
    const { container } = render(<BaseBuild {...props(failed([view]))} />);

    expect(
      container.querySelector('[data-slot="diagnostic-source"]')?.textContent
    ).toBe("5 | let x: u32 = 1;");
    expect(screen.queryByRole("button", { name: "Open in editor" })).toBeNull();
  });

  it("draws no empty source block for a card without one", () => {
    const view: DiagnosticView = {
      code: null,
      title: "Unparsed compiler error",
      explanation: "See raw output.",
      label: null,
      file: null,
      lines: null,
      excerpt: "",
      prompts: { explain: "explain", fix: "fix" },
    };
    const { container } = render(<BaseBuild {...props(failed([view]))} />);

    expect(
      container.querySelector('[data-slot="diagnostic-source"]')
    ).toBeNull();
  });

  it("names no count when none is known", () => {
    const surface: BuildSurfaceView = {
      kind: "failed",
      diagnostics: [typeError("a", "a")],
      errorCount: null,
      raw: RAW,
    };
    render(<BaseBuild {...props(surface)} />);

    expect(screen.getByText("2.9 s · api.solpg.io")).toBeTruthy();
  });

  it("folds the compiler's output away until asked", () => {
    render(<BaseBuild {...props(failed([typeError("a", "a")]))} />);

    const toggle = screen.getByRole("button", {
      name: /Show compiler output/,
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("1 warning");
    expect(screen.queryByText(/warning: unused/)).toBeNull();

    fireEvent.click(toggle);
    expect(
      screen
        .getByRole("button", { name: /Hide compiler output/ })
        .getAttribute("aria-expanded")
    ).toBe("true");
    expect(screen.getByText(/warning: unused/)).toBeTruthy();
  });

  // Spec 04: focus stays on the card, and a polite line says where the
  // answer goes
  it("says where the answer goes once Explain or Fix is pressed", () => {
    render(<BaseBuild {...props(failed([typeError("it", "a")]))} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    const explain = screen.getByRole("button", { name: "Explain" });
    explain.focus();
    fireEvent.click(explain);
    expect(status.textContent).toBe(
      "The assistant is answering in the side panel."
    );
    expect(document.activeElement).toBe(explain);
  });

  // A polite region speaks only when its text changes
  it("says it again for a second ask, and forgets it once a rebuild starts", () => {
    const surface = failed([typeError("it", "a")]);
    const { rerender } = render(<BaseBuild {...props(surface)} />);

    const status = screen.getByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    const first = status.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(status.textContent).not.toBe(first);
    expect(status.textContent?.trim()).toBe(
      "The assistant is answering in the side panel."
    );

    rerender(<BaseBuild {...props(surface, true)} />);
    rerender(<BaseBuild {...props(surface)} />);
    expect(screen.queryByText(/The assistant is answering/)).toBeNull();
  });

  // Spec 08 BUILD-05: a slow build is not a broken one
  it.each([
    ["the first build", { kind: "empty" } as BuildSurfaceView],
    ["a rebuild", { kind: "succeeded" } as BuildSurfaceView],
  ])("says %s is taking longer than usual once it is slow", (_, surface) => {
    const { rerender } = render(<BaseBuild {...props(surface, true)} />);
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();

    rerender(<BaseBuild {...props(surface, true, true)} />);
    expect(
      screen.getByText("This build is taking longer than usual.")
    ).toBeTruthy();
  });

  it("drops the slow line once the build is over", () => {
    render(<BaseBuild {...props({ kind: "succeeded" }, false, true)} />);

    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
  });

  // Spec 09: an empty lib.rs is named, and nothing went to the server
  it("says lib.rs is empty instead of building it", () => {
    const p = props({
      kind: "unreached",
      failure: {
        kind: "empty-source",
        file: "src/lib.rs",
        message: "lib.rs is empty.",
      },
    });
    const { container } = render(<BaseBuild {...p} />);

    expect(
      screen.getByRole("heading", { name: "lib.rs is empty" })
    ).toBeTruthy();
    expect(
      screen.getByText("Write a program, or ask the assistant for one.")
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open lib.rs" }));
    expect(p.onOpenFile).toHaveBeenCalledWith("src/lib.rs");
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(p.onBuild).toHaveBeenCalled();
    expect(brandButtons(container)).toHaveLength(1);
  });
});
