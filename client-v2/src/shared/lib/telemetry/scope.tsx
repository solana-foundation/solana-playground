import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import type { Tracker } from "./tracker";
import type { EventMap } from "./types";

const ScopeContext = createContext<string | undefined>(undefined);

/** Attributes events tracked through `useTracker` below it to `name` */
export const TelemetryScope = ({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) => <ScopeContext.Provider value={name}>{children}</ScopeContext.Provider>;

/** `tracker`, with the nearest `TelemetryScope` added to every event */
export const useTracker = <E extends EventMap>(
  tracker: Tracker<E>
): Pick<Tracker<E>, "track"> => {
  const scope = useContext(ScopeContext);
  return useMemo(
    () => ({
      track: (name, params) => tracker.track(name, params, scope),
    }),
    [tracker, scope]
  );
};
