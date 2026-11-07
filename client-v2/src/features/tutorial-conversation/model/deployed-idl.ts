import type { Idl } from "@coral-xyz/anchor";

/**
 * The IDL of the program as last deployed, which the Call panel reads: never
 * the last build's, nor the live file. Kept in the save, so project sync
 * carries it with the program and Start over clears it.
 */
export interface DeployedIdl {
  idl: Idl;
  /**
   * What the deploy that kept it brought, by name or {@link argKey}: the panel's "New".
   * Empty after a first deploy, where everything is new and nothing needs it.
   */
  added: string[];
}

/** An argument's key in `added`; an instruction's is its name */
export const argKey = (instruction: string, arg: string) =>
  `${instruction}.${arg}`;

/** What `next` holds that `previous` does not; nothing against no previous */
export const addedNames = (previous: Idl | undefined, next: Idl): string[] => {
  if (!previous) return [];
  const added: string[] = [];
  for (const ix of next.instructions) {
    const before = previous.instructions.find((p) => p.name === ix.name);
    if (!before) {
      added.push(ix.name);
      continue;
    }
    for (const arg of ix.args) {
      if (!before.args.some((a) => a.name === arg.name)) {
        added.push(argKey(ix.name, arg.name));
      }
    }
  }
  return added;
};

/** The IDL's callable shape: a new one lights the dot and fills "New" */
export const shapeOf = (idl: Idl): string =>
  JSON.stringify(
    idl.instructions.map((ix) => [ix.name, ix.args, ix.accounts ?? []])
  );

/**
 * The deployed IDL after a deploy of `idl`. A redeploy of the same shape keeps
 * what the last upgrade added, so its "New" still shows if not yet seen.
 */
export const nextDeployed = (
  previous: DeployedIdl | undefined,
  idl: Idl
): DeployedIdl => {
  if (previous && shapeOf(previous.idl) === shapeOf(idl)) {
    return { idl, added: previous.added };
  }
  return { idl, added: addedNames(previous?.idl, idl) };
};

const isReadableInstruction = (ix: unknown) => {
  if (typeof ix !== "object" || ix === null) return false;
  const { name, args, accounts } = ix as Record<string, unknown>;
  return (
    typeof name === "string" && Array.isArray(args) && Array.isArray(accounts)
  );
};

/** A saved deployed IDL, or undefined for one this client cannot read */
export const parseDeployed = (v: unknown): DeployedIdl | undefined => {
  if (typeof v !== "object" || v === null) return undefined;
  const { idl, added } = v as {
    idl?: { instructions?: unknown };
    added?: unknown;
  };
  if (!idl || !Array.isArray(idl.instructions)) return undefined;
  // The panel maps these on render: one it cannot read must not reach it
  if (!idl.instructions.every(isReadableInstruction)) return undefined;
  const names = Array.isArray(added)
    ? added.filter((a): a is string => typeof a === "string")
    : [];
  return { idl: idl as unknown as Idl, added: names };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const idlOf = (...ixs: { name: string; args?: string[] }[]): Idl =>
    ({
      version: "0.1.0",
      name: "hello_anchor",
      instructions: ixs.map((ix) => ({
        name: ix.name,
        accounts: [],
        args: (ix.args ?? []).map((name) => ({ name, type: "string" })),
      })),
    } as Idl);

  describe("features/tutorial-conversation/model/deployed-idl", () => {
    it("reads a save whose instruction lacks a list as none", () => {
      const instructions = [{ name: "hello", accounts: [] }];
      expect(parseDeployed({ idl: { instructions } })).toBeUndefined();
    });

    it("adds nothing on a first deploy", () => {
      expect(nextDeployed(undefined, idlOf({ name: "hello" })).added).toEqual(
        []
      );
    });

    it("names the argument an upgrade added", () => {
      const first = nextDeployed(undefined, idlOf({ name: "hello" }));
      const upgraded = nextDeployed(
        first,
        idlOf({ name: "hello", args: ["name"] })
      );
      expect(upgraded.added).toEqual(["hello.name"]);
    });

    it("names a whole new instruction, not its arguments", () => {
      expect(
        addedNames(
          idlOf({ name: "a" }),
          idlOf({ name: "a" }, { name: "b", args: ["x"] })
        )
      ).toEqual(["b"]);
    });

    it("keeps what the last upgrade added across a redeploy of one shape", () => {
      const upgraded = {
        idl: idlOf({ name: "hello", args: ["name"] }),
        added: ["hello.name"],
      };
      expect(
        nextDeployed(upgraded, idlOf({ name: "hello", args: ["name"] })).added
      ).toEqual(["hello.name"]);
    });

    it("reads a save back, and refuses one with no instructions", () => {
      const saved = { idl: idlOf({ name: "hello" }), added: ["hello"] };
      expect(parseDeployed(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
      expect(parseDeployed({ idl: {} })).toBeUndefined();
      expect(parseDeployed("nope")).toBeUndefined();
    });
  });
}
