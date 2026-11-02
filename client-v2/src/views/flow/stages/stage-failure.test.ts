// A Build or Deploy run's failure: told by the stage when it settled failed,
// by the button's toast otherwise.
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flow: { build: "done", deploy: "active" } as Record<string, string>,
}));

// The real flow store pulls in the whole playground; only its state is read
vi.mock("../state/stage", () => ({
  PgFlow: {
    get state() {
      return mocks.flow;
    },
  },
}));

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { PgView } from "@/utils/view";
import { toldByStage } from "./stage-failure";

type Stage = "build" | "deploy";

afterEach(() => {
  mocks.flow = { build: "done", deploy: "active" };
  vi.restoreAllMocks();
});

/** Runs the rejection through the stage's catch, then the button's */
const settle = (stage: Stage, status: string, error: unknown) => {
  mocks.flow = { build: "done", deploy: "active", [stage]: status };
  const toast = vi.spyOn(PgView, "setToast").mockImplementation(() => "");
  expect(() => toldByStage(stage)(error)).toThrow(error as Error);
  reportButtonFailure(stage)(error);
  return toast;
};

describe("toldByStage", () => {
  it("a build that left its stage failed is not toasted as well", () => {
    expect(settle("build", "failed", new Error("down"))).not.toHaveBeenCalled();
  });

  it("a deploy that left its stage failed is not toasted as well", () => {
    expect(
      settle("deploy", "failed", new Error("no SOL"))
    ).not.toHaveBeenCalled();
  });

  // No terminal mounted to run it: the command never started, so the stage
  // still shows the run before it
  it("a run that never started is still toasted", () => {
    expect(
      settle("deploy", "active", new Error("no terminal"))
    ).toHaveBeenCalledOnce();
  });
});
