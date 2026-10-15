import { afterEach, describe, expect, it } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from ".";

afterEach(() => resetLogger());

describe("reportButtonFailure", () => {
  it("logs the failure under ui:button, not marked for reporting", () => {
    const memory = memoryProvider();
    initLogger({ providers: [memory] });
    const failure = new Error("build server down");

    reportButtonFailure(failure);

    expect(memory.entries).toEqual([
      expect.objectContaining({ ns: "ui:button", error: failure }),
    ]);
    expect(memory.entries[0].report).toBeFalsy();
  });
});
