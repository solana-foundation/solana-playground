import { describe, expect, it, vi } from "vitest";

// The utils barrel reads a build-time global and cannot load under vitest;
// naming a setting needs only the real `PgCommon`
vi.mock("../../utils", async () => {
  const { PgCommon } = await import("../../utils/common");
  return { PgCommon, PgSettings: {} };
});

import { connection } from "../connection";
import { server } from "../server";

describe("settings names", () => {
  // A control is named by its setting: two settings of one name are two
  // controls a screen reader, or a test, cannot tell apart. Every name on the
  // page is held unique by the e2e "A wide window's settings page".
  it("names the endpoint and the build server apart, as the prototype does", () => {
    const rpc = connection.find((s) => s.id === "connection.endpoint");
    const build = server.find((s) => s.id === "server.endpoint");
    expect(rpc?.name).toBe("Endpoint");
    expect(build?.name).toBe("Build server");
  });
});
