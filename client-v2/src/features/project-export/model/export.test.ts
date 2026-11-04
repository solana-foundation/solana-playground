// `@types/mocha` also declares a global `it`, without `each`
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import type { TupleFiles } from "@/utils";

import {
  exportAsIs,
  exportConverted,
  exportedEndpoint,
  isDownloadFailure,
  readProjectKind,
} from "./export";

const UNKNOWN_FRAMEWORK = "Could not identify framework";

// The `utils` barrel needs a booted app; the flow uses these parts of it
const utils = vi.hoisted(() => ({
  PgConnection: {
    cluster: "devnet",
    current: { rpcEndpoint: "https://devnet.platform.example/?api-key=secret" },
  },
  PgFramework: {
    readWorkspaceFiles: vi.fn(),
    downloadZip: vi.fn(),
    convertToFramework: vi.fn(),
    getFromFiles: vi.fn(),
    hasProgram: (paths: string[]) =>
      paths.some((path) => /^src\/.+\.(rs|py)$/.test(path)),
    isUnknownFramework: (e: unknown) =>
      e instanceof Error && e.message === UNKNOWN_FRAMEWORK,
  },
}));
vi.mock("@/utils", () => utils);

// `frameworks/common` imports the barrel too; the profile's own tests cover
// what these two feed it
const common = vi.hoisted(() => ({
  addImports: (content: string) => content,
  getJSDependencyMap: vi.fn(),
}));
vi.mock("@/frameworks/common", () => common);

const NO_PROGRAM: TupleFiles = [
  ["client/client.ts", "console.log(await pg.connection.getSlot());"],
  ["tests/basic.test.ts", "it('runs', () => {});"],
];
const ANCHOR: TupleFiles = [["src/lib.rs", "use anchor_lang::prelude::*;"]];

let sent: ReturnType<typeof memoryProvider>;

beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  utils.PgFramework.readWorkspaceFiles
    .mockReset()
    .mockResolvedValue(NO_PROGRAM);
  utils.PgFramework.downloadZip.mockReset().mockResolvedValue(undefined);
  utils.PgFramework.convertToFramework.mockReset();
  utils.PgFramework.getFromFiles.mockReset().mockResolvedValue(undefined);
  common.getJSDependencyMap
    .mockReset()
    .mockResolvedValue({ "@solana/web3.js": "1.98.0" });
});

afterEach(() => resetTelemetry());

/** The zip `downloadZip` was given: its name and its paths */
const zipped = () => {
  const [name, files] = utils.PgFramework.downloadZip.mock.calls[0] as [
    string,
    TupleFiles
  ];
  return { name, paths: files.map(([path]) => path) };
};

describe("features/project-export/model/export", () => {
  describe("readProjectKind", () => {
    it("tells a project with a program from one with none", async () => {
      expect(await readProjectKind("beta")).toBe("no-program");
      utils.PgFramework.readWorkspaceFiles.mockResolvedValue(ANCHOR);
      expect(await readProjectKind("beta")).toBe("program");
      expect(utils.PgFramework.readWorkspaceFiles).toHaveBeenCalledWith("beta");
    });
  });

  describe("exportedEndpoint", () => {
    it("names the cluster's public endpoint, not the URL Playground uses", () => {
      expect(exportedEndpoint()).toBe("https://api.devnet.solana.com");
    });
  });

  describe("exportConverted and exportAsIs", () => {
    it("converts a project with no program with the TypeScript profile", async () => {
      const readme = await exportConverted("beta");

      expect(zipped()).toEqual({
        name: "beta",
        paths: [
          "client/client.ts",
          "tests/basic.test.ts",
          "package.json",
          "tsconfig.json",
          "README.md",
          ".gitignore",
          "playground.ts",
        ],
      });
      expect(readme).toContain("npm install");
      expect(utils.PgFramework.convertToFramework).not.toHaveBeenCalled();
      expect(sent.events).toEqual([
        {
          name: "export_downloaded",
          params: { profile: "typescript", files: 7 },
        },
      ]);
    });

    it("never writes the RPC URL Playground uses into the zip", async () => {
      await exportConverted("beta");

      const [, files] = utils.PgFramework.downloadZip.mock.calls[0] as [
        string,
        TupleFiles
      ];
      const text = files.map(([, content]) => content).join("\n");
      expect(text).not.toContain("api-key=secret");
      expect(text).toContain("https://api.devnet.solana.com");
    });

    it("converts a project with a program with its framework", async () => {
      utils.PgFramework.readWorkspaceFiles.mockResolvedValue(ANCHOR);
      const anchorFiles: TupleFiles = [
        ["programs/beta/src/lib.rs", "x"],
        ["Anchor.toml", "y"],
      ];
      utils.PgFramework.getFromFiles.mockResolvedValue({ name: "Anchor" });
      utils.PgFramework.convertToFramework.mockResolvedValue({
        files: anchorFiles,
        readme: "anchor readme",
        framework: "Anchor",
      });

      const readme = await exportConverted("beta");

      expect(utils.PgFramework.convertToFramework).toHaveBeenCalledWith(ANCHOR);
      expect(utils.PgFramework.downloadZip).toHaveBeenCalledWith(
        "beta",
        anchorFiles
      );
      expect(readme).toBe("anchor readme");
      expect(sent.events).toEqual([
        { name: "export_downloaded", params: { profile: "anchor", files: 2 } },
      ]);
    });

    it("exports the files as they are without converting", async () => {
      await exportAsIs("open-one");

      expect(utils.PgFramework.readWorkspaceFiles).toHaveBeenCalledWith(
        "open-one"
      );
      expect(utils.PgFramework.downloadZip).toHaveBeenCalledWith(
        "open-one",
        NO_PROGRAM
      );
      expect(sent.events).toEqual([
        { name: "export_downloaded", params: { profile: "as-is", files: 2 } },
      ]);
    });

    it("counts a program no framework knows, and rethrows for the fallback", async () => {
      utils.PgFramework.readWorkspaceFiles.mockResolvedValue(ANCHOR);
      utils.PgFramework.convertToFramework.mockRejectedValue(
        new Error(UNKNOWN_FRAMEWORK)
      );

      await expect(exportConverted("beta")).rejects.toThrow(UNKNOWN_FRAMEWORK);
      expect(utils.PgFramework.downloadZip).not.toHaveBeenCalled();
      expect(sent.events).toEqual([
        {
          name: "export_convert_failed",
          params: { profile: "unknown", reason: "unknown-framework" },
        },
      ]);
    });

    it("names the conversion that failed for another reason", async () => {
      utils.PgFramework.readWorkspaceFiles.mockResolvedValue(ANCHOR);
      utils.PgFramework.getFromFiles.mockResolvedValue({ name: "Seahorse" });
      utils.PgFramework.convertToFramework.mockRejectedValue(new Error("boom"));

      await expect(exportConverted("beta")).rejects.toThrow("boom");
      expect(sent.events).toEqual([
        {
          name: "export_convert_failed",
          params: { profile: "seahorse", reason: "error" },
        },
      ]);
    });

    it("counts an export that downloaded nothing", async () => {
      utils.PgFramework.downloadZip.mockRejectedValue(new Error("quota"));

      await expect(exportAsIs("open-one")).rejects.toThrow("quota");
      expect(sent.events).toEqual([
        { name: "export_failed", params: { profile: "as-is" } },
      ]);
    });

    it("counts a converted zip that did not download, apart from a conversion", async () => {
      utils.PgFramework.downloadZip.mockRejectedValue(new Error("quota"));

      const failure = await exportConverted("beta").catch((e: unknown) => e);
      expect(isDownloadFailure(failure)).toBe(true);
      expect((failure as Error).message).toBe("quota");
      expect(sent.events).toEqual([
        { name: "export_failed", params: { profile: "typescript" } },
      ]);
    });

    it("names the TypeScript profile when it fails", async () => {
      common.getJSDependencyMap.mockRejectedValue(new Error("offline"));

      const failure = await exportConverted("beta").catch((e: unknown) => e);
      expect(isDownloadFailure(failure)).toBe(false);
      expect(sent.events).toEqual([
        {
          name: "export_convert_failed",
          params: { profile: "typescript", reason: "error" },
        },
      ]);
    });

    it("says unknown when the project cannot be read", async () => {
      utils.PgFramework.readWorkspaceFiles.mockRejectedValue(new Error("EIO"));

      await expect(exportConverted("beta")).rejects.toThrow("EIO");
      expect(sent.events).toEqual([
        {
          name: "export_convert_failed",
          params: { profile: "unknown", reason: "error" },
        },
      ]);
    });
  });
});
