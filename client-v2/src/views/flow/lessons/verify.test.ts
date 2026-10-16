vi.mock("../../../utils", () => ({
  PgConnection: { cluster: "devnet" },
  PgExplorer: { currentWorkspaceName: "test" },
  PgGlobal: { deployState: "ready" },
}));

import { isSatisfied } from "./verify";
import { INITIAL_FLOW_STATE } from "../state/stage";
import type { FlowState } from "../state/stage";
import type { Idl } from "@coral-xyz/anchor";

const flow = (over: Partial<FlowState>): FlowState => ({
  ...INITIAL_FLOW_STATE,
  ...over,
});

/** Shaped like what an Anchor build regenerates for `hello-anchor`. */
const IDL_WITHOUT_ARG = {
  version: "0.1.0",
  name: "hello_anchor",
  instructions: [{ name: "hello", accounts: [], args: [] }],
} as Idl;

const IDL_WITH_ARG = {
  version: "0.1.0",
  name: "hello_anchor",
  instructions: [
    {
      name: "hello",
      accounts: [],
      args: [{ name: "name", type: "string" }],
    },
  ],
  accounts: [{ name: "Greeting", type: { kind: "struct", fields: [] } }],
} as Idl;

describe("build-passes", () => {
  it("is satisfied only when the build is done", () => {
    const c = { kind: "build-passes" } as const;
    expect(isSatisfied(c, flow({ build: "done" }), null)).toBe(true);
    expect(isSatisfied(c, flow({ build: "failed" }), null)).toBe(false);
    expect(isSatisfied(c, flow({ build: "running" }), null)).toBe(false);
    expect(isSatisfied(c, flow({ build: "upcoming" }), null)).toBe(false);
  });
});

describe("deployed", () => {
  it("is satisfied only when the deploy is done", () => {
    const c = { kind: "deployed" } as const;
    expect(isSatisfied(c, flow({ deploy: "done" }), null)).toBe(true);
    expect(isSatisfied(c, flow({ deploy: "failed" }), null)).toBe(false);
    expect(isSatisfied(c, flow({ deploy: "active" }), null)).toBe(false);
  });
});

describe("idl", () => {
  const state = flow({ build: "done" });

  it("is never satisfied without an IDL", () => {
    const c = { kind: "idl", instruction: "hello" } as const;
    expect(isSatisfied(c, state, null)).toBe(false);
  });

  it("finds an instruction by name", () => {
    const c = { kind: "idl", instruction: "hello" } as const;
    expect(isSatisfied(c, state, IDL_WITHOUT_ARG)).toBe(true);
  });

  it("does not find an instruction that is absent", () => {
    const c = { kind: "idl", instruction: "goodbye" } as const;
    expect(isSatisfied(c, state, IDL_WITHOUT_ARG)).toBe(false);
  });

  it("requires the named argument when one is asked for", () => {
    const c = { kind: "idl", instruction: "hello", arg: "name" } as const;
    expect(isSatisfied(c, state, IDL_WITHOUT_ARG)).toBe(false);
    expect(isSatisfied(c, state, IDL_WITH_ARG)).toBe(true);
  });

  it("requires the named account when one is asked for", () => {
    const c = {
      kind: "idl",
      instruction: "hello",
      account: "Greeting",
    } as const;
    expect(isSatisfied(c, state, IDL_WITHOUT_ARG)).toBe(false);
    expect(isSatisfied(c, state, IDL_WITH_ARG)).toBe(true);
  });

  it("matches names case-insensitively, since casing conventions differ", () => {
    const c = { kind: "idl", instruction: "Hello", arg: "Name" } as const;
    expect(isSatisfied(c, state, IDL_WITH_ARG)).toBe(true);
  });

  it("is not satisfied by a matching IDL while the build is not done", () => {
    // The IDL can be stale from a previous project during the window
    // right after a workspace switch, before `PgProgramInfo.idl`
    // catches up. A `PgFlow` event alone must not be enough to grade
    // against it.
    const c = { kind: "idl", instruction: "hello" } as const;
    expect(isSatisfied(c, flow({ build: "upcoming" }), IDL_WITHOUT_ARG)).toBe(
      false
    );
    expect(isSatisfied(c, flow({ build: "running" }), IDL_WITHOUT_ARG)).toBe(
      false
    );
    expect(isSatisfied(c, flow({ build: "failed" }), IDL_WITHOUT_ARG)).toBe(
      false
    );
  });
});

describe("read", () => {
  it("is never satisfied automatically", () => {
    const c = { kind: "read", at: "interact" } as const;
    expect(
      isSatisfied(c, flow({ build: "done", deploy: "done" }), IDL_WITH_ARG)
    ).toBe(false);
  });
});
