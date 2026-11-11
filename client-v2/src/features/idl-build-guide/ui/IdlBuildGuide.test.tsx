// The guide connected: its steps per method, the project download, and the
// events it sends. A file of its own, since it mocks the utils barrel.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLogs,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { TooltipProvider } from "@/shared/ui/tooltip";

const UNKNOWN_FRAMEWORK = "Could not identify framework";

const utils = vi.hoisted(() => ({
  PgFramework: {
    exportWorkspace: vi.fn(),
    isUnknownFramework: (e: unknown) =>
      e instanceof Error && e.message === "Could not identify framework",
  },
}));
vi.mock("@/utils", () => utils);
vi.mock("@/utils/explorer/workspace", () => ({
  PgWorkspace: { errors: { CURRENT_NOT_FOUND: "Current workspace not found" } },
}));

import IdlBuildGuide from "./IdlBuildGuide";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  utils.PgFramework.exportWorkspace.mockReset().mockResolvedValue({});
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetTelemetry();
  resetLogger();
});

const onLoadIdl = vi.fn<(file: File) => Promise<boolean>>();
const onInteract = vi.fn();

const openFrom = (surface: "build" | "deploy" | "interact") => {
  onLoadIdl.mockReset().mockResolvedValue(true);
  onInteract.mockReset();
  render(
    <TooltipProvider>
      <IdlBuildGuide
        surface={surface}
        onLoadIdl={onLoadIdl}
        onInteract={onInteract}
      />
    </TooltipProvider>
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Build the IDL locally" })
  );
  return screen.getByRole("dialog", { name: "Build the IDL on your machine" });
};

/** The scrolling steps, from the download to the build */
const steps = (dialog: HTMLElement) =>
  within(within(dialog).getByRole("list", { name: "Steps" })).getAllByRole(
    "listitem"
  );

const pick = (dialog: HTMLElement, method: "Docker" | "Local toolchain") =>
  fireEvent.click(within(dialog).getByRole("radio", { name: method }));

const drop = async (dialog: HTMLElement) => {
  const input = dialog.querySelector<HTMLInputElement>("input[type=file]");
  if (!input) throw new Error("no file input in the dialog");
  await act(async () =>
    fireEvent.change(input, {
      target: { files: [new File(["{}"], "idl.json")] },
    })
  );
};

describe("features/idl-build-guide", () => {
  it("opens on Docker, and Local toolchain replaces its steps", () => {
    const dialog = openFrom("build");
    expect(within(dialog).getByLabelText("IDL build method")).toBeTruthy();
    expect(dialog.textContent).toContain("quay.io/ottersec/anchor:v");
    expect(dialog.textContent).not.toContain("Install Rust");

    pick(dialog, "Local toolchain");

    expect(dialog.textContent).toContain("Install Rust, Solana CLI, Anchor");
    expect(dialog.textContent).toContain("anchor idl build -o idl.json");
    expect(dialog.textContent).not.toContain("docker run");
  });

  it("shows both methods and the toolchain install open", () => {
    const dialog = openFrom("build");
    expect(dialog.textContent).toContain("Only Docker needed");
    expect(dialog.textContent).toContain("Rust, Solana CLI, Anchor");

    pick(dialog, "Local toolchain");

    expect(dialog.textContent).toContain("rustup.rs");
    expect(dialog.textContent).toContain("rustup.rs");
    expect(dialog.textContent).toContain("release.anza.xyz");
    expect(dialog.textContent).toContain("avm install");
  });

  it.each(["Docker", "Local toolchain"] as const)(
    "ends %s at the IDL's drop zone",
    (method) => {
      const dialog = openFrom("build");
      pick(dialog, method);
      const upload = within(dialog).getByRole("list", {
        name: "Upload the IDL",
      });
      expect(upload.textContent).toContain("Drop idl.json or browse");
    }
  );

  it("loads a dropped IDL, then goes to Interact, and reports it", async () => {
    const dialog = openFrom("build");

    await drop(dialog);

    expect(onLoadIdl).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole("status").textContent).toContain(
      "IDL loaded"
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Go to Interact" })
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onInteract).toHaveBeenCalledOnce();
    expect(sent.events.map((e) => e.name)).toEqual([
      "idl_guide_opened",
      "idl_guide_idl_loaded",
    ]);
  });

  it("says so when the dropped file is not an IDL, and reports it", async () => {
    const dialog = openFrom("deploy");
    onLoadIdl.mockResolvedValue(false);

    await drop(dialog);

    expect(within(dialog).getByRole("alert").textContent).toBe(
      "That file is not an Anchor IDL."
    );
    expect(within(dialog).queryByRole("status")).toBeNull();
    expect(sent.events.map((e) => e.name)).toEqual([
      "idl_guide_opened",
      "idl_guide_idl_refused",
    ]);
  });

  it("starts both methods with Download project", () => {
    const dialog = openFrom("build");
    for (const method of ["Docker", "Local toolchain"] as const) {
      pick(dialog, method);
      expect(
        within(steps(dialog)[0]).getByRole("button", {
          name: "Download project",
        })
      ).toBeTruthy();
    }
  });

  // Scenario "Open, switch, copy"
  it("reports the open, the switch, and the copy, in that order", async () => {
    const dialog = openFrom("interact");
    pick(dialog, "Local toolchain");

    const installRust = within(dialog)
      .getByText("Rust")
      .closest("div") as HTMLElement;
    expect(installRust.textContent).toContain("rustup.rs");
    await act(async () =>
      fireEvent.click(
        within(installRust).getByRole("button", { name: "Copy command" })
      )
    );

    expect(sent.events.map((e) => [e.name, e.params])).toEqual([
      ["idl_guide_opened", { surface: "interact" }],
      ["idl_guide_method_picked", { method: "local" }],
      ["idl_guide_command_copied", { method: "local", step: "install-rust" }],
    ]);
  });

  it("counts no copy the clipboard refused", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const dialog = openFrom("deploy");

    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Copy command" })
      )
    );

    expect(sent.events.map((e) => e.name)).toEqual(["idl_guide_opened"]);
  });

  // Scenario "A saved zip"
  it("exports the workspace in its framework's layout and reports the zip", async () => {
    const dialog = openFrom("deploy");

    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Download project" })
      )
    );

    expect(utils.PgFramework.exportWorkspace).toHaveBeenCalledWith({
      convert: true,
    });
    expect(sent.events.map((e) => e.name)).toEqual([
      "idl_guide_opened",
      "idl_guide_project_downloaded",
    ]);
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  // Scenarios "A workspace whose framework cannot be told" and "A failed export"
  it("shows why the export failed, keeps the dialog open, and reports the reason", async () => {
    utils.PgFramework.exportWorkspace.mockRejectedValue(
      new Error(UNKNOWN_FRAMEWORK)
    );
    const dialog = openFrom("deploy");

    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Download project" })
      )
    );

    expect(within(dialog).getByRole("alert").textContent).toContain(
      "framework"
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(sent.events.map((e) => [e.name, e.params])).toEqual([
      ["idl_guide_opened", { surface: "deploy" }],
      ["idl_guide_export_failed", { reason: "unknown-framework" }],
    ]);
    expect(logged.entries.map((e) => [e.ns, e.report])).toEqual([
      ["idl-build-guide:ui", false],
    ]);
  });

  it.each([
    {
      error: new Error("Current workspace not found"),
      reason: "no-workspace",
      report: false,
    },
    { error: new Error("disk full"), reason: "other", report: true },
  ])(
    "reports a failed export as $reason, to the team only when unexpected",
    async ({ error, reason, report }) => {
      utils.PgFramework.exportWorkspace.mockRejectedValue(error);
      const dialog = openFrom("build");

      await act(async () =>
        fireEvent.click(
          within(dialog).getByRole("button", { name: "Download project" })
        )
      );

      expect(sent.events.at(-1)).toMatchObject({
        name: "idl_guide_export_failed",
        params: { reason },
      });
      expect(logged.entries.map((e) => e.report)).toEqual([report]);
    }
  );
});
