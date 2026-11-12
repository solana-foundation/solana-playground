import { ImportCancelledError } from "@/utils/import-error";

import { importReasonOf } from "./reason";
import type { ImportVia } from "./telemetry";
import { projectFilesTelemetry } from "./telemetry";

/**
 * Count a failed import: `project_import_failed` with the reason read from
 * the error's type (spec `client-v2-project-files`, "Import failures carry an
 * enumerated reason"). A closed program choice (`ImportCancelledError`) is
 * the user changing their mind and sends nothing.
 *
 * @param via where the import started
 * @param error what it threw
 */
export const trackImportFailure = (via: ImportVia, error: unknown) => {
  if (error instanceof ImportCancelledError) return;
  projectFilesTelemetry.track("project_import_failed", {
    via,
    reason: importReasonOf(error),
  });
};

/**
 * Run an import and count its outcome: `project_imported` once `run`
 * resolves, else `trackImportFailure`. The error is rethrown either way, so
 * the dialog still shows it.
 *
 * @param run the import, which resolves once the project exists
 * @param via where the import started
 * @returns what `run` resolves with
 */
export const trackImport = async <T>(run: () => Promise<T>, via: ImportVia) => {
  try {
    const result = await run();
    projectFilesTelemetry.track("project_imported", { via });
    return result;
  } catch (e) {
    trackImportFailure(via, e);
    throw e;
  }
};

if (import.meta.vitest) {
  const { beforeAll, beforeEach, describe, expect, it } = import.meta.vitest;

  describe("features/project-files/model/import", () => {
    let telemetry: typeof import("@/shared/lib/telemetry");
    let errors: typeof import("@/utils/import-error");
    let sent: ReturnType<
      typeof import("@/shared/lib/telemetry").memoryProvider
    >;

    beforeAll(async () => {
      telemetry = await import("@/shared/lib/telemetry");
      errors = await import("@/utils/import-error");
    });

    beforeEach(() => {
      telemetry.resetTelemetry();
      sent = telemetry.memoryProvider();
      telemetry.initTelemetry({ providers: [sent] });
    });

    it("counts an import once it resolves", async () => {
      await expect(trackImport(async () => "done", "github")).resolves.toBe(
        "done"
      );
      expect(sent.events).toEqual([
        expect.objectContaining({
          name: "project_imported",
          params: { via: "github" },
        }),
      ]);
    });

    it.each([
      [
        "not-found",
        (e: typeof errors) => new e.GithubImportError("missing", "not-found"),
      ],
      [
        "unsupported",
        (e: typeof errors) =>
          new e.ConversionError("no framework", "unsupported"),
      ],
      [
        "network",
        (e: typeof errors) => new e.GithubImportError("no answer", "network"),
      ],
      ["other", () => new Error("Invalid program url")],
    ] as const)(
      "counts a failure with reason %s and rethrows",
      async (reason, make) => {
        const error = make(errors);
        await expect(
          trackImport(async () => {
            throw error;
          }, "files")
        ).rejects.toBe(error);
        expect(sent.events).toEqual([
          expect.objectContaining({
            name: "project_import_failed",
            params: { via: "files", reason },
          }),
        ]);
      }
    );

    it("sends nothing for a closed program choice", async () => {
      const cancelled = new ImportCancelledError();
      await expect(
        trackImport(async () => {
          throw cancelled;
        }, "github")
      ).rejects.toBe(cancelled);
      expect(sent.events).toEqual([]);
    });

    it("counts a failure that was handled in place", () => {
      trackImportFailure(
        "files",
        new errors.GithubImportError("limit", "rate-limited")
      );
      expect(sent.events).toEqual([
        expect.objectContaining({
          name: "project_import_failed",
          params: { via: "files", reason: "rate-limited" },
        }),
      ]);
    });
  });
}
