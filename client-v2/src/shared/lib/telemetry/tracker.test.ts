import { initTelemetry, resetTelemetry } from "./collector";
import { memoryProvider } from "./providers/memory";
import { createTracker } from "./tracker";
import type { NoParams } from "./types";

// The type cases fail `yarn test-types` when a guard stops rejecting: an
// unused `@ts-expect-error` is itself an error

type FortyChars = {
  auth_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: NoParams;
};
type FortyOneChars = {
  auth_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: NoParams;
};

afterEach(() => resetTelemetry());

describe("createTracker name guard", () => {
  it("should accept a name of exactly 40 characters", () => {
    expect(createTracker<FortyChars>()).toBeDefined();
  });

  it("should reject a name of 41 characters", () => {
    // @ts-expect-error over GA4's 40-character limit
    expect(createTracker<FortyOneChars>()).toBeDefined();
  });

  it("should reject a wide key type", () => {
    // @ts-expect-error not a literal name
    expect(createTracker<Record<string, NoParams>>()).toBeDefined();
  });

  it("should reject an unregistered prefix", () => {
    // @ts-expect-error `nope` is not in EVENT_PREFIXES
    expect(createTracker<{ nope_clicked: NoParams }>()).toBeDefined();
  });

  it("should reject an object parameter", () => {
    // @ts-expect-error parameters are primitives
    expect(createTracker<{ auth_x: { user: { id: string } } }>()).toBeDefined();
  });
});

describe("track", () => {
  const tracker = createTracker<{
    auth_sign_in_failed: { reason: "cancelled" | "expired" };
  }>();

  it("should reject a misspelt name or a wrong parameter", () => {
    // @ts-expect-error not in the map
    tracker.track("auth_sign_in_faild", { reason: "cancelled" });
    // @ts-expect-error not an allowed value
    tracker.track("auth_sign_in_failed", { reason: "boom" });
  });

  it("should send the name, parameters and scope to the providers", () => {
    const sent = memoryProvider();
    initTelemetry({ providers: [sent] });

    tracker.track("auth_sign_in_failed", { reason: "expired" }, "deploy-panel");

    expect(sent.events).toEqual([
      {
        name: "auth_sign_in_failed",
        params: { reason: "expired" },
        scope: "deploy-panel",
      },
    ]);
  });
});
