import { emit } from "./collector";
import type { EventMap, FreeTextParams, NameGuard, ParamGuard } from "./types";

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
 * longer than GA4's 40 characters fails type-checking at this call. So does a
 * parameter name that is not snake_case, and a parameter typed as a wide
 * `string` unless `F` opts into it as free text with a reason; an opt-in that
 * names no free-text parameter fails too.
 *
 * @example
 * ```ts
 * type AuthEvents = { auth_signed_out: NoParams };
 * export const authTelemetry = createTracker<AuthEvents>();
 * ```
 */
export const createTracker = <
  E extends EventMap,
  F extends FreeTextParams = Record<never, string>
>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter exists for its type: the guards fail a bad event map at the call
  ..._guard: [...NameGuard<E>, ...ParamGuard<E, F>]
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

    describe("createTracker parameter guard", () => {
      it("should accept snake_case names with numbers, booleans and string literals", () => {
        expect(
          createTracker<{
            auth_x: { signed_in: boolean; step_2: number; via: "a" | "b" };
            auth_y: { kind: "a"; at?: number } | { kind: "b" };
          }>()
        ).toBeDefined();
      });

      it("should reject a camelCase parameter name", () => {
        expect(
          // @ts-expect-error `signedIn` is not snake_case
          createTracker<{ auth_x: { signedIn: boolean } }>()
        ).toBeDefined();
      });

      it("should reject a name with a doubled or trailing underscore", () => {
        expect(
          // @ts-expect-error `signed__in` is not snake_case
          createTracker<{ auth_x: { signed__in: boolean } }>()
        ).toBeDefined();
        // @ts-expect-error `signed_` is not snake_case
        expect(createTracker<{ auth_x: { signed_: boolean } }>()).toBeDefined();
      });

      it("should reject free text without an opt-in", () => {
        // @ts-expect-error `wallet` is a wide string
        expect(createTracker<{ auth_x: { wallet: string } }>()).toBeDefined();
        expect(
          // @ts-expect-error one branch of a union carries a wide string
          createTracker<{ auth_x: { via: "a" } | { via: string } }>()
        ).toBeDefined();
      });

      it("should accept free text the tracker opts into with a reason", () => {
        expect(
          createTracker<
            { auth_x: { wallet: string } },
            { wallet: "a brand name the wallet sets" }
          >()
        ).toBeDefined();
      });

      it("should reject an opt-in that names no free-text parameter", () => {
        expect(
          // @ts-expect-error `via` is a literal union, not free text
          createTracker<{ auth_x: { via: "a" } }, { via: "unused" }>()
        ).toBeDefined();
      });

      it("should reject an opt-in without a reason", () => {
        expect(
          // @ts-expect-error the reason is a wide string
          createTracker<{ auth_x: { wallet: string } }, { wallet: string }>()
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
