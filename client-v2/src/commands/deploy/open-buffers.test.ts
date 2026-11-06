import { describe, expect, it } from "vitest";

import { PgFs } from "../../utils/explorer/fs";
import type { OpenBuffer } from "./open-buffers";
import {
  forgetOpenBuffer,
  listOpenBuffers,
  recordOpenBuffer,
} from "./open-buffers";

const bufferOf =
  (authority: string) =>
  (address: string): OpenBuffer => ({
    address,
    authority,
    endpoint: "https://api.devnet.solana.com",
    cluster: "devnet",
    at: "2026-11-06T17:00:00.000Z",
  });
const buffer = bufferOf("Pg1111");

describe("open buffers", () => {
  it("keeps a buffer until it is forgotten", async () => {
    await recordOpenBuffer(buffer("BufA"));
    await recordOpenBuffer(buffer("BufB"));
    await forgetOpenBuffer("BufA");

    expect(await listOpenBuffers()).toEqual([buffer("BufB")]);
    await forgetOpenBuffer("BufB");
    expect(await listOpenBuffers()).toEqual([]);
  });

  // `setBufferAuthority` hands the close to the standard wallet
  it("replaces an earlier record of the same buffer", async () => {
    await recordOpenBuffer(buffer("BufC"));
    await recordOpenBuffer(bufferOf("Std1111")("BufC"));

    expect(await listOpenBuffers()).toEqual([bufferOf("Std1111")("BufC")]);
    await forgetOpenBuffer("BufC");
  });

  it("skips a record it cannot parse", async () => {
    await recordOpenBuffer(buffer("BufD"));
    await PgFs.writeFile("/.config/deploy/open-buffers/BufE.json", "{", {
      createParents: true,
    });

    expect(await listOpenBuffers()).toEqual([buffer("BufD")]);
    await forgetOpenBuffer("BufD");
    await PgFs.removeFile("/.config/deploy/open-buffers/BufE.json");
  });

  it("forgets a buffer it never recorded without complaint", async () => {
    await expect(forgetOpenBuffer("BufNone")).resolves.toBeUndefined();
  });
});
