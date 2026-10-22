import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import { useSendAndReceiveCustomEvent } from "./useSendAndReceiveCustomEvent";
import { PgCommon } from "../utils/common";

const event = "pg-test-hook-get";
const noReceiver = () => new Error("nothing is listening");

afterEach(cleanup);

describe("useSendAndReceiveCustomEvent", () => {
  it("claims the event, so a caller that needs a receiver gets its answer", async () => {
    renderHook(() => useSendAndReceiveCustomEvent(event, async () => "term"));

    await expect(
      PgCommon.sendAndReceiveCustomEvent(event, undefined, { noReceiver })
    ).resolves.toBe("term");
  });

  it("stops claiming once unmounted", async () => {
    const { unmount } = renderHook(() =>
      useSendAndReceiveCustomEvent(event, async () => "term")
    );
    unmount();

    await expect(
      PgCommon.sendAndReceiveCustomEvent(event, undefined, { noReceiver })
    ).rejects.toThrow("nothing is listening");
  });
});
