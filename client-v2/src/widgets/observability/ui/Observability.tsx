import { useState } from "react";
import type { ReactNode } from "react";

import { LoggerErrorBoundary } from "../../../shared/lib/logger";
import { GoogleAnalytics } from "../../../shared/lib/telemetry";
import { initObservability } from "../model/init";
import type { ObservabilityConfig } from "../model/init";

export interface ObservabilityProps extends ObservabilityConfig {
  /** Shown in place of `children` after a render error */
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * Initialises the logger, Sentry and telemetry, then renders `children`
 * under an error boundary. Each vendor does nothing until its id is passed.
 */
export const Observability = ({
  sentry,
  logLevel,
  googleAnalytics,
  fallback,
  children,
}: ObservabilityProps) => {
  // A state initialiser runs during the first render, before `children` render,
  // so an error they throw already reaches Sentry; an effect would run after them
  useState(() => initObservability({ sentry, googleAnalytics, logLevel }));

  return (
    <LoggerErrorBoundary fallback={fallback}>
      <GoogleAnalytics measurementId={googleAnalytics.measurementId} />
      {children}
    </LoggerErrorBoundary>
  );
};
