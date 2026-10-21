import { beforeEach, describe, expect, it } from "vitest";

import { forgetColumn, keepColumn, keepTab, keptColumn } from "./kept-column";

describe("keepTab", () => {
  beforeEach(() => {
    forgetColumn();
    keepColumn({ workspace: "a", tab: "files", scrollTop: 120 });
  });

  it("keeps the scroll of the same project", () => {
    keepTab("a", "steps");
    expect(keptColumn("a")).toEqual({ tab: "steps", scrollTop: 120 });
  });

  it("starts another project at the top", () => {
    keepTab("b", "steps");
    expect(keptColumn("b")).toEqual({ tab: "steps", scrollTop: 0 });
    // One memory: the other project's is replaced, not kept beside it
    expect(keptColumn("a")).toBeNull();
  });

  it("does nothing with no project open", () => {
    keepTab(undefined, "steps");
    expect(keptColumn("a")).toEqual({ tab: "files", scrollTop: 120 });
  });
});
