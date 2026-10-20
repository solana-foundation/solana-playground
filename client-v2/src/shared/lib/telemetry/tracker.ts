import { emit } from "./collector";
import type { EventMap, NameGuard } from "./types";

export interface Tracker<E extends EventMap> {
  track<K extends Extract<keyof E, string>>(
    name: K,
    params: E[K],
    scope?: string
  ): void;
}

/**
 * A slice's tracker for the events in `E`.
 *
 * A name that is not a literal, lacks a prefix from `EVENT_PREFIXES`, or is
 * longer than GA4's 40 characters fails type-checking at this call.
 *
 * @example
 * ```ts
 * type AuthEvents = { auth_signed_out: NoParams };
 * export const authTelemetry = createTracker<AuthEvents>();
 * ```
 */
export const createTracker = <E extends EventMap>(
  ..._guard: NameGuard<E>
): Tracker<E> => ({
  track: (name, params, scope) => emit({ name, params, scope }),
});

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll, afterEach } = import.meta.vitest;
  type NoParams = import("./types").NoParams;
  describe("shared/lib/telemetry/tracker", () => {
    let initTelemetry: typeof import("./collector").initTelemetry;
    let resetTelemetry: typeof import("./collector").resetTelemetry;
    let memoryProvider: typeof import("./providers/memory").memoryProvider;
    beforeAll(async () => {
      ({ initTelemetry, resetTelemetry } = await import("./collector"));
      ({ memoryProvider } = await import("./providers/memory"));
    });
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
        expect(
          // @ts-expect-error parameters are primitives
          createTracker<{ auth_x: { user: { id: string } } }>()
        ).toBeDefined();
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

        tracker.track(
          "auth_sign_in_failed",
          { reason: "expired" },
          "deploy-panel"
        );

        expect(sent.events).toEqual([
          {
            name: "auth_sign_in_failed",
            params: { reason: "expired" },
            scope: "deploy-panel",
          },
        ]);
      });
    });
  });
}
