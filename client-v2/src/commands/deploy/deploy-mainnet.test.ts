import { describe, expect, it, vi } from "vitest";

import { checkWallet } from "../checks";
import { checkNotMainnet } from "./check-not-mainnet";
import { deploy } from "./deploy";

vi.mock("../../utils", () => ({
  PgCommon: {},
  PgConnection: {},
  PgGlobal: {},
  PgProgramInfo: {},
  PgServer: {},
  PgTerminal: {},
  PgTx: {},
  PgView: {},
  PgWallet: {},
  PgWeb3: {},
}));

describe("deploy", () => {
  // First, so a mainnet deploy is refused before the wallet question and
  // before anything is sent; every caller (stage, terminal, Program Pal,
  // explorer menu) runs the command's pre-checks
  it("refuses mainnet before any other check", () => {
    const checks = [deploy.preChecks].flat();
    expect(checks[0]).toBe(checkNotMainnet);
    expect(checks).toContain(checkWallet);
  });
});
