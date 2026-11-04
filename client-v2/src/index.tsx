import React from "react";
import { createRoot } from "react-dom/client";

import App, { CrashFallback } from "./app";
import { observabilityEnv } from "./shared/config/client-env";
import { Observability } from "./widgets/observability";
import "./index.css";

const env = observabilityEnv();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Observability
      sentry={{
        dsn: env.SENTRY_DSN,
        release: env.VERCEL_GIT_COMMIT_SHA,
        environment: env.VERCEL_ENV,
      }}
      googleAnalytics={{ measurementId: env.GA_MEASUREMENT_ID }}
      fallback={<CrashFallback />}
    >
      <App />
    </Observability>
  </React.StrictMode>
);
