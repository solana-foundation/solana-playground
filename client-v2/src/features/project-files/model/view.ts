import { ImportCancelledError } from "@/utils/import-error";

import { importReasonOf } from "./reason";
import { projectFilesTelemetry } from "./telemetry";

/**
 * Count a GitHub link's load: `project_viewed` once `run` resolves, else
 * `project_view_failed` with the reason `importReasonOf` maps from the error
 * (spec `client-v2-project-files`, "A project opened from a GitHub link is
 * counted"). A closed program choice (`ImportCancelledError`) is the user
 * changing their mind and sends nothing, as for an import. The error is
 * rethrown either way, so the route still shows it as before.
 *
 * @param run the load to count; the `github` route passes `PgGithub.getFiles`
 * @returns what `run` resolves with
 */
export const trackView = async <T>(run: () => Promise<T>) => {
  try {
    const result = await run();
    projectFilesTelemetry.track("project_viewed", {});
    return result;
  } catch (e) {
    if (!(e instanceof ImportCancelledError)) {
      projectFilesTelemetry.track("project_view_failed", {
        reason: importReasonOf(e),
      });
    }
    throw e;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll, beforeEach } = import.meta.vitest;
  describe("features/project-files/model/view", () => {
    let telemetry: typeof import("@/shared/lib/telemetry");
    let errors: typeof import("@/utils/import-error");
    let sent: ReturnType<typeof telemetry.memoryProvider>;
    beforeAll(async () => {
      telemetry = await import("@/shared/lib/telemetry");
      errors = await import("@/utils/import-error");
    });
    beforeEach(() => {
      telemetry.resetTelemetry();
      sent = telemetry.memoryProvider();
      telemetry.initTelemetry({ providers: [sent] });
    });

    it("counts a GitHub link that opens", async () => {
      await expect(trackView(async () => ["files"])).resolves.toEqual([
        "files",
      ]);
      expect(sent.events).toEqual([
        expect.objectContaining({ name: "project_viewed", params: {} }),
      ]);
    });

    it.each([
      ["not-found", () => new errors.GithubImportError("missing", "not-found")],
      ["network", () => new errors.GithubImportError("no answer", "network")],
    ] as const)(
      "counts a link that fails with %s and rethrows",
      async (reason, make) => {
        const error = make();
        await expect(
          trackView(async () => {
            throw error;
          })
        ).rejects.toBe(error);
        expect(sent.events).toEqual([
          expect.objectContaining({
            name: "project_view_failed",
            params: { reason },
          }),
        ]);
      }
    );

    it("sends nothing for a closed program choice", async () => {
      const cancelled = new errors.ImportCancelledError();
      await expect(
        trackView(async () => {
          throw cancelled;
        })
      ).rejects.toBe(cancelled);
      expect(sent.events).toEqual([]);
    });
  });
}
