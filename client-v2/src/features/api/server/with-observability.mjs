// Observability for the API functions: one `http.server` span per request,
// errors captured, flushed before the function returns. Sentry is the
// provider, and runs only where the browser reports too (`sentryEnabled`);
// elsewhere `@sentry/node` is never imported.
import { sentryEnabled } from "../../../../scripts/sentry-gate.mjs";
import { sentryEnv } from "../../../shared/config/server-env.mjs";

/**
 * `SENTRY_TRACES_SAMPLE_RATE` as a rate: unset traces everything, and a value
 * outside 0..1 falls back to that too, with a warning.
 *
 * @param {string | undefined} value
 * @returns {number}
 */
export const tracesSampleRate = (value) => {
  if (value === undefined) return 1;
  const rate = Number(value);
  if (value.trim() !== "" && rate >= 0 && rate <= 1) return rate;
  console.warn(
    `api: SENTRY_TRACES_SAMPLE_RATE=${value} is not a rate from 0 to 1; using 1`
  );
  return 1;
};

/** The initialised SDK, `null` where Sentry is off; one per function instance */
let sdk;

const loadSentry = () => {
  if (sdk !== undefined) return sdk;
  const env = sentryEnv();
  if (!sentryEnabled(env)) return (sdk = Promise.resolve(null));

  const rate = tracesSampleRate(env.SENTRY_TRACES_SAMPLE_RATE);
  sdk = import("@sentry/node").then((Sentry) => {
    Sentry.init({
      dsn: env.REACT_APP_SENTRY_DSN,
      environment: env.VERCEL_ENV,
      release: env.VERCEL_GIT_COMMIT_SHA,
      // A request the browser already traces keeps the browser's decision
      tracesSampler: ({ inheritOrSampleWith }) => inheritOrSampleWith(rate),
      // `withObservability` names each request's span by route; the SDK's own
      // incoming-request span would be a second, unnamed trace per request
      integrations: [
        Sentry.httpIntegration({ disableIncomingRequestSpans: true }),
      ],
    });
    return Sentry;
  });
  return sdk;
};

/**
 * `handler` with a trace span named `<METHOD> /api/<route>` around each
 * request. Where the provider is off, the request goes straight to `handler`.
 *
 * @param {string} route the function's name under `/api`
 * @param {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => unknown} handler
 */
export const withObservability = (route, handler) => async (req, res) => {
  const Sentry = await loadSentry();
  if (!Sentry) return handler(req, res);

  try {
    return await Sentry.continueTrace(
      {
        sentryTrace: req.headers["sentry-trace"],
        baggage: req.headers.baggage,
      },
      () =>
        Sentry.startSpan(
          {
            name: `${req.method} /api/${route}`,
            op: "http.server",
            attributes: { "http.request.method": req.method },
          },
          async (span) => {
            try {
              const result = await handler(req, res);
              span.setAttribute("http.response.status_code", res.statusCode);
              if (res.statusCode >= 500) {
                span.setStatus({ code: 2, message: "internal_error" });
              }
              return result;
            } catch (error) {
              span.setStatus({ code: 2, message: "internal_error" });
              Sentry.captureException(error);
              throw error;
            }
          }
        )
    );
  } finally {
    // Vercel may freeze the instance once the handler resolves
    await Sentry.flush(2000);
  }
};
