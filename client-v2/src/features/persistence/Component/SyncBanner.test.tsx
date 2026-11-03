// The resolve view loads Monaco, which jsdom cannot run; it is not opened
vi.mock("../ui/ConflictResolver", () => ({ ConflictResolver: () => null }));
// The banner binds its onError at render, before a test could spy on it
const report = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: vi.fn(() => report),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
// `@types/mocha` also declares a global `it`, without `each`
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";

import SyncBanner from "./SyncBanner";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { PgProjectSync } from "../model/project-sync";
import type { FileConflict } from "../model/merge";
import type { LimitExceeded } from "@/entities/project";
import { PgExplorer } from "../../../utils/explorer/explorer";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("SyncBanner telemetry", () => {
  let container: HTMLDivElement;
  let root: Root;
  let sent: ReturnType<typeof memoryProvider>;

  beforeEach(async () => {
    sent = memoryProvider();
    initTelemetry({ providers: [sent] });
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("p1");
    vi.spyOn(PgExplorer, "onDidSwitchWorkspace").mockReturnValue({
      dispose: () => undefined,
    });
    vi.spyOn(PgProjectSync, "onDidChangeConflicts").mockReturnValue({
      dispose: () => undefined,
    });
    vi.spyOn(PgProjectSync, "conflictFor").mockReturnValue({
      projectId: "p1",
      kind: "divergent",
      paths: ["src/lib.rs"],
    });
    vi.spyOn(PgProjectSync, "resolve").mockResolvedValue(true);
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => root.render(<SyncBanner />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    resetTelemetry();
  });

  it.each([
    ["Keep this version", "keep-local"],
    ["Take the other version", "take-server"],
  ])("tracks %s from the banner", async (label, answer) => {
    const found = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === label
    );
    await act(async () => found!.click());

    expect(sent.events).toEqual([
      { name: "sync_whole_file_answered", params: { answer, from: "banner" } },
    ]);
    expect(PgProjectSync.resolve).toHaveBeenCalledWith("p1", answer);
  });

  it("reports an answer that fails and leaves the prompt up", async () => {
    const failure = new Error("offline");
    vi.spyOn(PgProjectSync, "resolve").mockRejectedValue(failure);
    const found = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Keep this version"
    );
    await act(async () => found!.click());

    expect(reportButtonFailure).toHaveBeenCalledWith("apply your choice");
    expect(report).toHaveBeenCalledWith(failure);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(found!.disabled).toBe(false);
  });
});

describe("SyncBanner wording", () => {
  let container: HTMLDivElement;
  let root: Root;

  /** The banner's text for a divergent conflict over `files` */
  const messageFor = async (files: FileConflict[]) => {
    vi.spyOn(PgProjectSync, "conflictFor").mockReturnValue({
      projectId: "p1",
      kind: "divergent",
      paths: files.map(({ path }) => path),
      files,
    });
    // The banner reads the conflict as it mounts, so each question is a mount
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<SyncBanner />));
    return container.querySelector('[role="alert"] p')!.textContent;
  };

  /** A file still in conflict */
  const open = (path: string): FileConflict => ({
    kind: "whole",
    path,
    local: "mine",
    server: "theirs",
    localHash: "l",
    serverHash: "s",
  });
  /** A file a refused answer was about, which now merges on its own */
  const settled = (path: string): FileConflict => ({
    kind: "settled",
    path,
    content: "merged",
  });

  beforeEach(() => {
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("p1");
    vi.spyOn(PgExplorer, "onDidSwitchWorkspace").mockReturnValue({
      dispose: () => undefined,
    });
    vi.spyOn(PgProjectSync, "onDidChangeConflicts").mockReturnValue({
      dispose: () => undefined,
    });
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("names only the files still in conflict as changed in the same place", async () => {
    expect(await messageFor([open("src/lib.rs"), open("Cargo.toml")])).toBe(
      "src/lib.rs and 1 other file changed on another device and on this one, in the same place. Everything else was merged."
    );
    expect(await messageFor([settled("Cargo.toml"), open("src/lib.rs")])).toBe(
      "src/lib.rs changed on another device and on this one, in the same place. Other files changed again while you were resolving; review them before applying."
    );
  });

  it("does not call a refused answer's merged files a same-place change", async () => {
    expect(await messageFor([settled("src/lib.rs")])).toBe(
      "src/lib.rs changed on another device while you were resolving. Review before applying."
    );
  });

  it("names the limit a project too large to sync is over", async () => {
    vi.spyOn(PgProjectSync, "conflictFor").mockReturnValue({
      projectId: "p1",
      kind: "too-large",
    });
    await act(async () => root.render(<SyncBanner />));
    expect(container.querySelector('[role="alert"] p')!.textContent).toBe(
      "This project is over 1 MiB. Remove or shrink its largest files, then try again."
    );
  });

  it("says another project in the account uses the name", async () => {
    vi.spyOn(PgProjectSync, "conflictFor").mockReturnValue({
      projectId: "p1",
      kind: "name-taken",
    });
    await act(async () => root.render(<SyncBanner />));
    expect(container.querySelector('[role="alert"] p')!.textContent).toBe(
      "Another project in your account uses this name. Rename this one, then try again."
    );
  });

  it("offers to keep a copy of a project deleted on another device", async () => {
    vi.spyOn(PgProjectSync, "conflictFor").mockReturnValue({
      projectId: "p1",
      kind: "deleted-elsewhere",
    });
    await act(async () => root.render(<SyncBanner />));
    expect(container.querySelector('[role="alert"] p')!.textContent).toBe(
      "This project was deleted on another device, but this one has unsaved changes."
    );
    const labels = [...container.querySelectorAll("button")].map(
      (b) => b.textContent
    );
    expect(labels).toContain("Keep a copy");
    expect(labels).toContain("Delete anyway");
  });
});

describe("SyncBanner limit wording", () => {
  let container: HTMLDivElement;
  let root: Root;

  /** The banner's text, and its one button, for a `too-large` conflict */
  const bannerFor = async (limit?: LimitExceeded) => {
    vi.spyOn(PgProjectSync, "conflictFor").mockReturnValue(
      limit
        ? { projectId: "p1", kind: "too-large", limit }
        : { projectId: "p1", kind: "too-large" }
    );
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<SyncBanner />));
    const banner = container.querySelector('[data-testid="sync-banner"]')!;
    expect(banner.getAttribute("role")).toBe("alert");
    return {
      text: banner.querySelector("p")!.textContent,
      buttons: Array.from(banner.querySelectorAll("button")).map((b) =>
        b.textContent?.trim()
      ),
    };
  };

  beforeEach(() => {
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("p1");
    vi.spyOn(PgExplorer, "onDidSwitchWorkspace").mockReturnValue({
      dispose: () => undefined,
    });
    vi.spyOn(PgProjectSync, "onDidChangeConflicts").mockReturnValue({
      dispose: () => undefined,
    });
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("names one file over the file size limit", async () => {
    expect(
      await bannerFor({
        reason: "file-too-large",
        limit: 131_072,
        paths: ["src/lib.rs"],
        sizes: { "src/lib.rs": 143_360 },
      })
    ).toEqual({
      text: "src/lib.rs is 140 KB. A file can be at most 128 KB. Shrink or remove it, then try again.",
      buttons: ["Try again"],
    });
  });

  it("names the first three of several files over it", async () => {
    const paths = ["a.rs", "b.rs", "c.rs", "d.rs", "e.rs"];
    const { text } = await bannerFor({
      reason: "file-too-large",
      limit: 131_072,
      paths,
      sizes: Object.fromEntries(paths.map((p) => [p, 200_000])),
    });
    expect(text).toBe(
      "a.rs, b.rs, c.rs and 2 more are over 128 KB. A file can be at most 128 KB. Shrink or remove them, then try again."
    );
  });

  it("cuts a path over the path limit to 60 characters", async () => {
    const path = `src/${"n".repeat(300)}.rs`;
    const { text } = await bannerFor({
      reason: "path-too-long",
      limit: 256,
      paths: [path],
    });
    expect(text).toBe(
      `A file path is longer than 256 characters: ${path.slice(
        0,
        60
      )}…. A file path can be at most 256 characters. Rename or move it, then try again.`
    );
  });

  it("names too many files", async () => {
    const { text } = await bannerFor({
      reason: "too-many-files",
      limit: 50,
      count: 64,
    });
    expect(text).toBe(
      "This project has 64 files. A project can have at most 50. Remove some, then try again."
    );
  });

  it("names a project over the size limit", async () => {
    const { text } = await bannerFor({
      reason: "project-too-large",
      limit: 524_288,
      size: 614_400,
    });
    expect(text).toBe(
      "This project is 600 KB. A project can be at most 512 KB. Remove or shrink some files, then try again."
    );
  });

  it("names the body cap when the refusal names no limit", async () => {
    expect((await bannerFor()).text).toBe(
      "This project is over 1 MiB. Remove or shrink its largest files, then try again."
    );
  });
});
