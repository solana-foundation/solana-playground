import { createLogger } from "../../shared/lib/logger";
import { PgCommon } from "../common";
import type { Disposable } from "../types";
import { addInit, addOnDidChange, getChangePropName, PROPS } from "./common";

const log = createLogger("utils:derivable");

/** Derivable state properties */
export type DerivableState<T> = {
  readonly // eslint-disable-next-line @typescript-eslint/no-unused-vars
  [K in keyof T]: T[K] extends Derivable<infer _, infer R, infer I>
    ? I extends true
      ? Awaited<R>
      : Awaited<R | null>
    : never;
};

/** Derivable property declaration */
type Derivable<T = any, R = unknown, I extends boolean = boolean> = {
  /** Derive to get the value. */
  derive: (value: T) => R;
  /** Derive method will be called whenever there is a change. */
  onChange: OnChange<T> | OnChange[];
  /** Whether the `derive` method is infallible i.e. cannot throw */
  infallible?: I;
  /** Whether to skip caching derived values and always dispatch change events */
  noCache?: boolean;
};

/** Either `onChange` method or a string that will be checked from the state */
type OnChange<T = unknown> = ((cb: (value?: T) => void) => Disposable) | string;

/**
 * Make the given static class derivable.
 *
 * This decorator defines properties from the given state keys and they will be
 * updated based on the given `onChange` event(s).
 *
 * The properties are read-only and the only way to update the values is to
 * trigger the given `onChange` method(s).
 */
export function derivable<T extends Derivable>(
  deriveState: () => { [key: string]: T }
) {
  return (sClass: any) => {
    // Add `init` method
    addInit(sClass, () => {
      const state = deriveState();

      // Add `onDidChange` methods
      addOnDidChange(sClass, state);

      const disposables: Disposable[] = [];
      for (const prop in state) {
        // Define getter
        if (!Object.hasOwn(sClass, prop)) {
          Object.defineProperty(sClass, prop, {
            get: () => sClass[PROPS.INTERNAL_STATE][prop],
          });
        }

        const entry = state[prop];
        const derive: typeof entry["derive"] = async (value) => {
          if (entry.infallible) return await entry.derive(value);

          try {
            return await entry.derive(value);
          } catch (e) {
            // A failed derivation reads as `null` (a fetch that could not
            // reach the network, for one); quiet, since a caller shows it
            log.debug("Derivation failed", {
              context: { prop, reason: String(e) },
            });
            return null;
          }
        };
        const disposable = PgCommon.batchChanges(
          async (value) => {
            sClass[PROPS.INTERNAL_STATE][prop] = await derive(value);
            sClass[PROPS.DISPATCH_CHANGE_EVENT](prop, entry.noCache);
          },
          PgCommon.toArray(entry.onChange).map((onChange) => {
            if (typeof onChange === "string") {
              return sClass[getChangePropName(onChange)];
            }

            return onChange;
          })
        );
        disposables.push(disposable);
      }

      return {
        dispose: () => disposables.forEach(({ dispose }) => dispose()),
      };
    });
  };
}

/**
 * Create a derivable.
 *
 * This function is a type helper function.
 */
export const createDerivable = <T, R, C extends boolean = false>(
  definition: Derivable<T, R, C>
) => definition;
