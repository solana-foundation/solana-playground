import type { Idl } from "@coral-xyz/anchor";

import { sameIdlName } from "@/shared/lib/idl-name";

import type { DeployedIdl } from "./deployed-idl";
import { argKey } from "./deployed-idl";
import type { RunResult } from "./progress";
import { existsLine, existsOf, isUnconfirmed } from "./progress";

/** A string argument stops here, as the tutorial's own programs expect */
export const STRING_MAX = 32;

export type CallPanelTab = "form" | "idl";

/** The call the panel holds the result of: only the latest */
export interface LastCall {
  instruction: string;
  args: Record<string, string>;
  /** The deployed IDL it was sent to: a later deploy's program did not answer */
  deployed: DeployedIdl;
  result: RunResult;
}

/** What `callView` reads: the engine's facts and the panel's own state */
export interface CallViewInput {
  deployed: DeployedIdl | undefined;
  /** The instruction the live step's goal names, if any */
  live: string | undefined;
  /** The chip the learner pressed since the panel opened, if any */
  picked: string | undefined;
  values: Record<string, Record<string, string>>;
  /** The upgrade's "New" shows: the panel's first view of this IDL */
  showNew: boolean;
  last: LastCall | undefined;
  calling: boolean;
  /** An act card's run is in flight */
  busy: boolean;
  /** The accounts neither the defaults nor earlier calls fill, for an instruction */
  emptyAccounts: (ix: Idl["instructions"][number]) => string[];
}

export interface CallField {
  name: string;
  /** The type as Rust writes it, the field's placeholder */
  type: string;
  value: string;
  isNew: boolean;
  numeric: boolean;
  max?: number;
}

export interface CallChip {
  name: string;
  isNew: boolean;
}

export interface CallView {
  program: string;
  instruction: string;
  /** The picker's chips; one instruction has no picker, so none */
  chips: CallChip[];
  /** The instruction's arguments as the signature writes them */
  signature: string;
  /** The same call as `client.ts` writes it */
  code: string;
  fields: CallField[];
  /** Why the call cannot go at all, over the button that it keeps off */
  note: string | undefined;
  canCall: boolean;
  /**
   * The latest call on these fields went out but devnet has not read it back:
   * Check again reads it, and Call stays off, since a second send would repeat
   * its account change and its fee
   */
  canRecheck: boolean;
  calling: boolean;
  json: string;
  /** The latest call, when it answers the instruction shown on this deploy */
  result: RunResult | undefined;
  /** That call's line when the account the goal creates was already there (`existsLine`) */
  exists: string | undefined;
  /** The fields moved on since that call: what it was sent with, and it dims */
  stale: string | undefined;
}

type IdlType = string | Record<string, unknown>;

/** An IDL type as Rust writes it: u64, vec<u8>, option<string>, [u8; 32] */
const typeName = (type: IdlType): string => {
  if (typeof type === "string") return type;
  const [kind, inner] = Object.entries(type)[0] ?? ["", ""];
  if (kind === "array" && Array.isArray(inner)) {
    return `[${typeName(inner[0] as IdlType)}; ${String(inner[1])}]`;
  }
  if (kind === "defined") {
    return typeof inner === "string"
      ? inner
      : String((inner as { name?: string })?.name ?? "defined");
  }
  return `${kind}<${typeName(inner as IdlType)}>`;
};

/** Snake to camel, which `PgCommon.toCamelCase` does not do: it keeps `_` */
const camel = (name: string) =>
  name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

/** Hello Anchor's IDL is the older shape; a newer build names it in `metadata` */
const programName = (idl: Idl) =>
  (idl as unknown as { metadata?: { name?: string } }).metadata?.name ??
  idl.name;

const isOptional = (type: IdlType) =>
  typeof type === "object" && "option" in type;

/** "Last call, with name "Ada", at 35000": numbers bare, the rest quoted */
const sentWith = (args: Record<string, string>) => {
  const said = Object.entries(args).map(
    ([k, v]) => `${k} ${/^\d+$/.test(v) ? v : JSON.stringify(v)}`
  );
  return said.length ? `Last call, with ${said.join(", ")}` : "Last call";
};

/** The panel as it shows; undefined before any deploy */
/** The instruction the last upgrade added last, if it added one */
const latestAdded = ({ idl, added }: DeployedIdl) =>
  added
    .flatMap((name) => idl.instructions.filter((ix) => ix.name === name))
    .at(-1);

export const callView = (input: CallViewInput): CallView | undefined => {
  const {
    deployed,
    live,
    picked,
    values,
    showNew,
    last,
    calling,
    busy,
    emptyAccounts,
  } = input;
  const ixs = deployed?.idl.instructions ?? [];
  if (!deployed || ixs.length === 0) return undefined;
  const ix =
    ixs.find((i) => i.name === picked) ??
    (live === undefined
      ? undefined
      : ixs.find((i) => sameIdlName(i.name, live))) ??
    latestAdded(deployed) ??
    ixs[ixs.length - 1];
  const typed = values[ix.name] ?? {};
  const isNew = (key: string) => showNew && deployed.added.includes(key);
  const fields: CallField[] = ix.args.map((arg) => {
    const type = typeName(arg.type as IdlType);
    return {
      name: arg.name,
      type,
      value: typed[arg.name] ?? "",
      isNew: isNew(argKey(ix.name, arg.name)),
      numeric: /^[ui]\d+$/.test(type),
      ...(type === "string" ? { max: STRING_MAX } : {}),
    };
  });
  const missing = ix.args.some(
    (arg) => !isOptional(arg.type as IdlType) && !typed[arg.name]?.trim()
  );
  const empty = emptyAccounts(ix);
  const note = empty.length
    ? `\`${ix.name}\` needs ${empty
        .map((name) => `\`${name}\``)
        .join(
          " and "
        )}, which this form can't fill yet. Call it from client.ts.`
    : undefined;

  // A call of another instruction, or to a program since redeployed, is not
  // this form's answer. The chip back brings it again while it is the latest
  const answers =
    last && last.instruction === ix.name && last.deployed === deployed;
  const moved =
    answers &&
    ix.args.some((a) => (typed[a.name] ?? "") !== (last.args[a.name] ?? ""));
  const pending = answers && !moved && isUnconfirmed(last.result);
  const exists = answers ? existsOf(last.result) : undefined;
  return {
    program: programName(deployed.idl),
    instruction: ix.name,
    chips:
      ixs.length > 1
        ? ixs.map((i) => ({ name: i.name, isNew: isNew(i.name) }))
        : [],
    signature: `(${ix.args
      .map((a) => `${a.name}: ${typeName(a.type as IdlType)}`)
      .join(", ")})`,
    code: `pg.program.methods.${camel(ix.name)}(${ix.args
      .map((a) => a.name)
      .join(", ")}).rpc()`,
    fields,
    note,
    canCall: !calling && !busy && !missing && !note && !pending,
    canRecheck: !calling && !busy && Boolean(pending),
    calling,
    json: JSON.stringify(deployed.idl, undefined, 2),
    result: answers ? last.result : undefined,
    exists: exists ? existsLine(exists) : undefined,
    stale: moved ? sentWith(last.args) : undefined,
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const idlOf = (
    ...ixs: { name: string; accounts?: unknown[]; args?: unknown[] }[]
  ): Idl =>
    ({
      version: "0.1.0",
      name: "hello_anchor",
      instructions: ixs.map((ix) => ({
        name: ix.name,
        accounts: ix.accounts ?? [],
        args: ix.args ?? [],
      })),
    } as unknown as Idl);
  const NAME = { name: "name", type: "string" };
  const input = (over: Partial<CallViewInput>): CallViewInput => ({
    deployed:
      "deployed" in over
        ? over.deployed
        : { idl: idlOf({ name: "hello" }), added: [] },
    live: over.live,
    picked: over.picked,
    values: over.values ?? {},
    showNew: over.showNew ?? false,
    last: over.last,
    calling: over.calling ?? false,
    busy: over.busy ?? false,
    emptyAccounts: over.emptyAccounts ?? (() => []),
  });
  const ok: RunResult = {
    act: "call",
    ok: true,
    seconds: 1,
    signatures: ["sig"],
    line: "Hello",
    called: [],
  };

  describe("features/tutorial-conversation/model/call-view", () => {
    it("has nothing before a deploy", () => {
      expect(callView(input({ deployed: undefined }))).toBeUndefined();
    });

    it("draws one instruction with no chips, ready to call", () => {
      const v = callView(input({}));
      expect(v?.chips).toEqual([]);
      expect(v?.signature).toBe("()");
      expect(v?.code).toBe("pg.program.methods.hello().rpc()");
      expect(v?.canCall).toBe(true);
    });

    it("picks what the upgrade added over the IDL's last", () => {
      const deployed = {
        idl: idlOf({ name: "added" }, { name: "older" }),
        added: ["added", "added.at"],
      };
      expect(callView(input({ deployed }))?.instruction).toBe("added");
    });

    it("picks the live step's instruction by its Rust spelling", () => {
      const deployed = {
        idl: idlOf({ name: "chopTree" }, { name: "grow" }),
        added: [],
      };
      expect(
        callView(input({ deployed, live: "chop_tree" }))?.instruction
      ).toBe("chopTree");
    });

    it("picks the live step's instruction, else the latest added", () => {
      const deployed = {
        idl: idlOf({ name: "a" }, { name: "b" }, { name: "c" }),
        added: [],
      };
      const shown = (over: Partial<CallViewInput>) =>
        callView(input({ deployed, live: over.live, picked: over.picked }));
      expect(shown({ live: "b" })?.instruction).toBe("b");
      expect(shown({})?.instruction).toBe("c");
      expect(shown({ live: "b", picked: "a" })?.instruction).toBe("a");
      expect(shown({ live: "b" })?.chips.map((c) => c.name)).toEqual([
        "a",
        "b",
        "c",
      ]);
    });

    it("tags what the upgrade added on the first view only", () => {
      const deployed = {
        idl: idlOf({ name: "hello", args: [NAME] }),
        added: ["hello.name"],
      };
      expect(
        callView(input({ deployed, showNew: true }))?.fields[0]
      ).toMatchObject({ name: "name", type: "string", isNew: true, max: 32 });
      expect(
        callView(input({ deployed, showNew: false }))?.fields[0].isNew
      ).toBe(false);
    });

    it("keeps Call off while a required field is empty, or anything runs", () => {
      const deployed = {
        idl: idlOf({ name: "hello", args: [NAME] }),
        added: [],
      };
      const filled = { hello: { name: "Ada" } };
      expect(callView(input({ deployed }))?.canCall).toBe(false);
      expect(
        callView(input({ deployed, values: { hello: { name: "  " } } }))
          ?.canCall
      ).toBe(false);
      expect(callView(input({ deployed, values: filled }))?.canCall).toBe(true);
      expect(
        callView(input({ deployed, values: filled, calling: true }))?.canCall
      ).toBe(false);
      expect(
        callView(input({ deployed, values: filled, busy: true }))?.canCall
      ).toBe(false);
    });

    it("says why when an account is left empty, and never fills it", () => {
      const v = callView(input({ emptyAccounts: () => ["map"] }));
      expect(v?.canCall).toBe(false);
      expect(v?.note).toContain("`map`");
    });

    describe("the result", () => {
      const deployed = {
        idl: idlOf({ name: "a", args: [NAME] }, { name: "b" }),
        added: [],
      };
      const last: LastCall = {
        instruction: "a",
        args: { name: "Ada" },
        deployed,
        result: ok,
      };
      const values = { a: { name: "Ada" } };

      it("answers its own instruction", () => {
        const v = callView(input({ deployed, last, values, picked: "a" }));
        expect(v?.result).toBe(ok);
        expect(v?.stale).toBeUndefined();
      });

      it("hides on another chip and comes back with its own", () => {
        expect(
          callView(input({ deployed, last, values, picked: "b" }))?.result
        ).toBeUndefined();
        expect(
          callView(input({ deployed, last, values, picked: "a" }))?.result
        ).toBe(ok);
      });

      it("says what it was sent with once the fields move on", () => {
        const v = callView(
          input({ deployed, last, picked: "a", values: { a: { name: "Bo" } } })
        );
        expect(v?.result).toBe(ok);
        expect(v?.stale).toBe('Last call, with name "Ada"');
      });

      it("keeps Call off for a call devnet has not read back, and offers Check again, until the fields move on", () => {
        const pending: LastCall = {
          instruction: "a",
          args: { name: "Ada" },
          deployed,
          result: {
            act: "call",
            ok: false,
            seconds: 1,
            reason: "unconfirmed",
            message: "Devnet has not confirmed this transaction yet.",
            log: "",
            unconfirmed: [],
          },
        };
        const same = callView(
          input({ deployed, last: pending, values, picked: "a" })
        );
        expect(same?.canCall).toBe(false);
        expect(same?.canRecheck).toBe(true);
        const moved = callView(
          input({
            deployed,
            last: pending,
            picked: "a",
            values: { a: { name: "Bo" } },
          })
        );
        expect(moved?.canCall).toBe(true);
        expect(moved?.canRecheck).toBe(false);
      });

      it("writes numbers bare", () => {
        const numbers = {
          idl: idlOf({ name: "a", args: [{ name: "at", type: "u32" }] }),
          added: [],
        };
        expect(
          callView(
            input({
              deployed: numbers,
              last: {
                instruction: "a",
                args: { at: "35000" },
                deployed: numbers,
                result: ok,
              },
              values: { a: { at: "1" } },
            })
          )?.stale
        ).toBe("Last call, with at 35000");
      });

      it("goes with a later deploy, even of the same shape", () => {
        const redeployed = { idl: deployed.idl, added: deployed.added };
        expect(
          callView(input({ deployed: redeployed, last, values, picked: "a" }))
            ?.result
        ).toBeUndefined();
      });
    });
  });
}
