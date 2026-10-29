import { PgServerError } from "@/utils/server-error";

/**
 * Why a binary download failed: `no-build` when this browser holds no build
 * id to ask for, `not-built` when the server no longer holds the build,
 * `server` for any other refusal, no answer or an empty answer, `save` when the bytes came but
 * the browser could not be handed them
 */
export type DownloadFailure = "no-build" | "not-built" | "server" | "save";

/** A server failure, as `downloadFailure` classifies it */
type ServerFailure = Extract<DownloadFailure, "not-built" | "server">;

/** What the build server says when the build's directory is gone */
const NOT_BUILT = "Program is not built";

/**
 * Classifies a failed `PgServer.deploy`. Only the server's own "not built"
 * answer (500, `Program is not built`) asks for a rebuild. A 404 is not the
 * server's own answer: api.solpg.io returns nginx's 404 for a route it does
 * not serve (`/unstable/deploy`, probed 2026-10-29), which no build fixes.
 */
export const downloadFailure = (error: unknown): ServerFailure =>
  error instanceof PgServerError &&
  error.status === 500 &&
  error.body.trim() === NOT_BUILT
    ? "not-built"
    : "server";

/**
 * A name in the snake_case Anchor gives its program files. A camelCase word
 * boundary splits too: an IDL from before Anchor 0.30 names the program
 * `helloAnchor`, its files `hello_anchor.so`.
 */
const snake = (name: string) =>
  name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/**
 * The name the program's files go by: `<name>.so` and `<name>-keypair.json`,
 * as Anchor names them after the crate. The IDL carries it (`metadata.name`
 * since Anchor 0.30, `name` before); a project without an IDL falls back to
 * its workspace name.
 */
export const programName = (p: {
  idlName: string | null | undefined;
  workspace: string | null | undefined;
}) => snake(p.idlName ?? "") || snake(p.workspace ?? "") || "program";

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/cli-deploy/model/program", () => {
    it("asks for a rebuild only on the server's 'not built' answer", () => {
      const url = "http://server.test/deploy/u";
      expect(
        downloadFailure(new PgServerError(url, 500, "Program is not built"))
      ).toBe("not-built");
      expect(downloadFailure(new PgServerError(url, 500, "disk full"))).toBe(
        "server"
      );
      expect(
        downloadFailure(new PgServerError(url, 404, "Program is not built"))
      ).toBe("server");
      expect(downloadFailure(new PgServerError(url, null, "offline"))).toBe(
        "server"
      );
      expect(downloadFailure(new Error("Program is not built"))).toBe("server");
    });

    it("names the program after the IDL, then the workspace", () => {
      expect(programName({ idlName: "hello_anchor", workspace: "X" })).toBe(
        "hello_anchor"
      );
      expect(programName({ idlName: null, workspace: "My Counter!" })).toBe(
        "my_counter"
      );
      expect(programName({ idlName: "helloAnchor", workspace: null })).toBe(
        "hello_anchor"
      );
      expect(programName({ idlName: "Counter2Pda", workspace: null })).toBe(
        "counter2_pda"
      );
      expect(programName({ idlName: undefined, workspace: "  " })).toBe(
        "program"
      );
    });
  });
}
