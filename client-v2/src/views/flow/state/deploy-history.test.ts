import type { Mock } from "vitest";
vi.mock("../../../utils", () => ({
  PgCommand: {
    deploy: {
      onDidFinish: vi.fn(() => ({ dispose: vi.fn() })),
    },
  },
  PgConnection: {
    cluster: "devnet",
  },
  PgExplorer: {
    currentWorkspaceName: "test-workspace",
  },
  PgGlobal: {
    deployState: "ready",
  },
  PgProgramInfo: {
    getPkStr: vi.fn(() => "testProgramId"),
  },
}));

import { PgDeployHistory } from "./deploy-history";

/** The mocked utils module, in the shape the factory above gives it */
const mockedUtils = async () =>
  (await import("../../../utils")) as unknown as {
    PgCommand: { deploy: { onDidFinish: Mock } };
    PgConnection: { cluster: string };
    PgExplorer: { currentWorkspaceName: string | null };
    PgGlobal: { deployState: string };
    PgProgramInfo: { getPkStr: Mock };
  };

describe("PgDeployHistory", () => {
  beforeEach(() => localStorage.clear());

  it("is empty for an unknown workspace", () => {
    expect(PgDeployHistory.list("none")).toEqual([]);
    expect(PgDeployHistory.latest("none")).toBeNull();
  });

  it("adds records newest-first and persists them", () => {
    PgDeployHistory.add({
      workspace: "w",
      cluster: "devnet",
      programId: "A",
      signature: "s1",
    });
    PgDeployHistory.add({
      workspace: "w",
      cluster: "devnet",
      programId: "B",
      signature: null,
    });
    const list = PgDeployHistory.list("w");
    expect(list.map((r) => r.programId)).toEqual(["B", "A"]);
    expect(PgDeployHistory.latest("w")?.programId).toBe("B");
    expect(
      JSON.parse(localStorage.getItem("flow.deploys") ?? "[]")
    ).toHaveLength(2);
  });

  it("notifies listeners on add", () => {
    const cb = vi.fn();
    PgDeployHistory.onDidChange(cb);
    PgDeployHistory.add({
      workspace: "w",
      cluster: "devnet",
      programId: "A",
      signature: null,
    });
    expect(cb).toHaveBeenCalledTimes(2); // once immediately, once on add
  });
});

describe("PgDeployHistory.init wiring", () => {
  beforeEach(() => localStorage.clear());

  it("records deploys from onDidFinish callback", async () => {
    const { PgCommand, PgConnection, PgExplorer, PgProgramInfo } =
      await mockedUtils();
    let deployCallback: ((result: unknown) => void) | undefined;

    // Set up mocks
    const deployFinishMock = PgCommand.deploy.onDidFinish;
    const deployFinishReturn = { dispose: vi.fn() };
    deployFinishMock.mockImplementation((cb) => {
      deployCallback = cb;
      return deployFinishReturn;
    });

    const { PgGlobal } = await mockedUtils();
    PgGlobal.deployState = "ready";
    PgConnection.cluster = "devnet";
    PgExplorer.currentWorkspaceName = "w";
    PgProgramInfo.getPkStr.mockReturnValue("Prog111");

    // Initialize and verify callback was captured
    const sub = PgDeployHistory.init();
    expect(deployCallback).toBeDefined();

    // Test error case: should not record
    deployCallback!({ err: new Error("deploy failed") });
    expect(PgDeployHistory.list("w")).toHaveLength(0);

    // Test success case: should record with null signature
    deployCallback!({ ok: undefined });
    const list = PgDeployHistory.list("w");
    expect(list).toHaveLength(1);
    expect(list[0].programId).toBe("Prog111");
    expect(list[0].cluster).toBe("devnet");
    expect(list[0].signature).toBeNull();

    // Clean up
    sub.dispose();
  });

  it("does not record a finish caused by pausing/resuming a deploy", async () => {
    const { PgCommand, PgConnection, PgExplorer, PgGlobal, PgProgramInfo } =
      await mockedUtils();
    let deployCallback: ((result: unknown) => void) | undefined;

    const deployFinishMock = PgCommand.deploy.onDidFinish;
    deployFinishMock.mockImplementation((cb) => {
      deployCallback = cb;
      return { dispose: vi.fn() };
    });

    PgConnection.cluster = "devnet";
    PgExplorer.currentWorkspaceName = "w";
    PgProgramInfo.getPkStr.mockReturnValue("Prog111");

    const sub = PgDeployHistory.init();
    expect(deployCallback).toBeDefined();

    // A second click while a deploy is running pauses it and resolves the
    // command promise with `ok: undefined` -- not a real completion.
    PgGlobal.deployState = "paused";
    deployCallback!({ ok: undefined });
    expect(PgDeployHistory.list("w")).toHaveLength(0);

    // Resuming does the same: the resume click itself resolves immediately.
    PgGlobal.deployState = "loading";
    deployCallback!({ ok: undefined });
    expect(PgDeployHistory.list("w")).toHaveLength(0);

    // The real completion, once the deploy command actually finishes.
    PgGlobal.deployState = "ready";
    deployCallback!({ ok: undefined });
    expect(PgDeployHistory.list("w")).toHaveLength(1);

    sub.dispose();
  });
});

describe("PgDeployHistory malformed records", () => {
  beforeEach(() => localStorage.clear());

  it("drops non-array storage entirely", () => {
    localStorage.setItem("flow.deploys", JSON.stringify({ not: "an array" }));
    expect(PgDeployHistory.list("w")).toEqual([]);
  });

  it("drops individual records missing or mistyped fields", () => {
    const good = {
      id: "A-1",
      workspace: "w",
      cluster: "devnet",
      programId: "A",
      signature: null,
      at: 1,
    };
    const badRecords = [
      good,
      { ...good, id: "B-1", programId: 123 }, // wrong type
      { ...good, id: "C-1", at: "yesterday" }, // wrong type
      { ...good, id: "D-1", cluster: undefined }, // missing field
      "just a string",
      null,
    ];
    localStorage.setItem("flow.deploys", JSON.stringify(badRecords));

    const list = PgDeployHistory.list("w");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("A-1");
  });

  it("caps the stored list at 50 records", () => {
    for (let i = 0; i < 55; i++) {
      PgDeployHistory.add({
        workspace: "w",
        cluster: "devnet",
        programId: `P${i}`,
        signature: null,
      });
    }
    expect(PgDeployHistory.list("w")).toHaveLength(50);
    // Newest-first: the most recent 50 survive, not the oldest.
    expect(PgDeployHistory.list("w")[0].programId).toBe("P54");
  });
});
