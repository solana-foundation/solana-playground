import { readIdl } from "@/entities/idl";

/** What the Interact stage shows: the form, or why the program cannot be called yet */
export type InteractSurface =
  | "no-project"
  | "not-built"
  | "no-idl"
  | "no-program-id"
  | "bad-idl"
  | "checking"
  | "unreachable"
  | "not-deployed"
  | "ready";

/** What `interactSurface` reads from the explorer and `PgProgramInfo` */
export interface InteractFacts {
  /** A workspace is open, or the explorer is temporary */
  hasProject: boolean;
  /** `PgProgramInfo.idl` as stored; `instructions` is read here, the rest by `readIdl` */
  idl: { instructions?: unknown } | null;
  /** `readIdl` refused the IDL: it cannot be called, whatever it holds */
  refused?: boolean;
  /** `importedProgram` or `uuid` is set: the program was not built here */
  imported: boolean;
  hasProgramId: boolean;
  /**
   * `PgProgramInfo.onChain`: `undefined` until its first read settles, `null`
   * when a read failed (the derivable catches the error and stores `null`)
   */
  onChain: { deployed: boolean } | null | undefined;
}

/**
 * Picks the Interact stage's surface; the first missing piece wins, in the
 * order the embedded form checked before 5.12. No build is required: an IDL
 * can arrive without one, through "Upload IDL".
 */
export const interactSurface = (f: InteractFacts): InteractSurface => {
  if (!f.hasProject) return "no-project";
  if (!f.idl) return f.imported ? "no-idl" : "not-built";
  if (!f.hasProgramId) return "no-program-id";
  if (!Array.isArray(f.idl.instructions) || f.refused) return "bad-idl";
  if (f.onChain === undefined) return "checking";
  if (!f.onChain) return "unreachable";
  if (!f.onChain.deployed) return "not-deployed";
  return "ready";
};

/** The facts, from what `useExplorer` and `useProgramInfo` return */
export const interactFacts = (
  explorer: { isTemporary: boolean; currentWorkspaceName?: string | null },
  programInfo: {
    idl: InteractFacts["idl"];
    importedProgram: unknown;
    uuid: string | null | undefined;
    pk: unknown;
    onChain: InteractFacts["onChain"];
  }
): InteractFacts => ({
  hasProject: explorer.isTemporary || !!explorer.currentWorkspaceName,
  idl: programInfo.idl,
  refused: !!programInfo.idl && readIdl(programInfo.idl).kind === "refused",
  imported: !!(programInfo.importedProgram || programInfo.uuid),
  hasProgramId: !!programInfo.pk,
  onChain: programInfo.onChain,
});

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/stages/interact-surface", () => {
    const IDL = { instructions: [] };

    describe("interactSurface", () => {
      it("no open project wins over everything", () => {
        expect(
          interactSurface({
            hasProject: false,
            idl: IDL,
            imported: false,
            hasProgramId: true,
            onChain: { deployed: true },
          })
        ).toBe("no-project");
      });

      it("no IDL on the project's own program asks for a build", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: null,
            imported: false,
            hasProgramId: true,
            onChain: { deployed: true },
          })
        ).toBe("not-built");
      });

      it("no IDL on an imported program asks for the IDL", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: null,
            imported: true,
            hasProgramId: true,
            onChain: { deployed: true },
          })
        ).toBe("no-idl");
      });

      it("an IDL without a program id", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: IDL,
            imported: false,
            hasProgramId: false,
            onChain: { deployed: true },
          })
        ).toBe("no-program-id");
      });

      it("an IDL with no instructions is a bad IDL", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: {},
            imported: false,
            hasProgramId: true,
            onChain: { deployed: true },
          })
        ).toBe("bad-idl");
      });

      it("a chain read that has not settled yet is checking", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: IDL,
            imported: false,
            hasProgramId: true,
            onChain: undefined,
          })
        ).toBe("checking");
      });

      it("a failed chain read is unreachable", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: IDL,
            imported: false,
            hasProgramId: true,
            onChain: null,
          })
        ).toBe("unreachable");
      });

      it("instructions that are not a list make a bad IDL", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: { instructions: { initialize: {} } },
            imported: false,
            hasProgramId: true,
            onChain: { deployed: true },
          })
        ).toBe("bad-idl");
      });

      it("a refused IDL is a bad IDL even with a list of instructions", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: IDL,
            refused: true,
            imported: false,
            hasProgramId: true,
            onChain: { deployed: true },
          })
        ).toBe("bad-idl");
      });

      it("a missing program id is said before a bad IDL", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: {},
            imported: false,
            hasProgramId: false,
            onChain: { deployed: true },
          })
        ).toBe("no-program-id");
      });

      it("an imported program with its IDL is ready", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: IDL,
            imported: true,
            hasProgramId: true,
            onChain: { deployed: true },
          })
        ).toBe("ready");
      });

      it("a program not on the cluster is not deployed", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: IDL,
            imported: false,
            hasProgramId: true,
            onChain: { deployed: false },
          })
        ).toBe("not-deployed");
      });

      it("a deployed program with an IDL is ready", () => {
        expect(
          interactSurface({
            hasProject: true,
            idl: IDL,
            imported: false,
            hasProgramId: true,
            onChain: { deployed: true },
          })
        ).toBe("ready");
      });
    });

    describe("interactFacts", () => {
      const PK = { toBase58: () => "6PNd" };

      it("an Anchor 1.x IDL with a custom discriminator is refused", () => {
        const idl = {
          address: "11111111111111111111111111111111",
          metadata: { name: "p", version: "0.1.0", spec: "0.1.0" },
          instructions: [
            { name: "initialize", discriminator: [1], accounts: [], args: [] },
          ],
        };
        const facts = (raw: typeof idl | { name: string; instructions: [] }) =>
          interactFacts(
            { isTemporary: false, currentWorkspaceName: "p" },
            {
              idl: raw,
              importedProgram: null,
              uuid: null,
              pk: PK,
              onChain: { deployed: true },
            }
          );
        expect(facts(idl).refused).toBe(true);
        expect(facts({ name: "p", instructions: [] }).refused).toBe(false);
      });

      it("a temporary explorer counts as a project", () => {
        expect(
          interactFacts(
            { isTemporary: true, currentWorkspaceName: null },
            {
              idl: null,
              importedProgram: null,
              uuid: null,
              pk: null,
              onChain: undefined,
            }
          ).hasProject
        ).toBe(true);
      });

      it("no workspace and no temporary explorer is no project", () => {
        expect(
          interactFacts(
            { isTemporary: false, currentWorkspaceName: null },
            {
              idl: null,
              importedProgram: null,
              uuid: null,
              pk: null,
              onChain: undefined,
            }
          ).hasProject
        ).toBe(false);
      });

      it("a program uploaded by uuid counts as imported", () => {
        expect(
          interactFacts(
            { isTemporary: false, currentWorkspaceName: "p" },
            {
              idl: null,
              importedProgram: null,
              uuid: "u-1",
              pk: PK,
              onChain: null,
            }
          )
        ).toEqual({
          hasProject: true,
          idl: null,
          refused: false,
          imported: true,
          hasProgramId: true,
          onChain: null,
        });
      });

      it("an imported program counts as imported", () => {
        expect(
          interactFacts(
            { isTemporary: false, currentWorkspaceName: "p" },
            {
              idl: null,
              importedProgram: { buffer: [] },
              uuid: null,
              pk: null,
              onChain: undefined,
            }
          ).imported
        ).toBe(true);
      });
    });
  });
}
