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

/** Request headers worth keeping on an event; every other one is dropped */
const KEPT_HEADERS = new Set([
  "accept",
  "content-length",
  "content-type",
  "host",
  "user-agent",
  "x-vercel-id",
]);

/**
 * What leaves the function on an event: never a body, a cookie, the query
 * string (an OAuth callback carries its `code` there), a header outside
 * `KEPT_HEADERS` (`authorization`, and the key headers a client may send), or
 * the user. Applies to error events: the SDK's default trace lifecycle sends
 * spans one by one, which carry only the route, method and status that
 * `withObservability` sets, and ignores `beforeSendTransaction`.
 *
 * @template {import("@sentry/node").ErrorEvent} E
 * @param {E} event
 * @returns {E}
 */
export const scrubEvent = (event) => {
  delete event.user;
  const request = event.request;
  if (!request) return event;
  delete request.data;
  delete request.cookies;
  delete request.query_string;
  if (request.url) request.url = request.url.split(/[?#]/)[0];
  if (request.headers) {
    request.headers = Object.fromEntries(
      Object.entries(request.headers).filter(([name]) =>
        KEPT_HEADERS.has(name.toLowerCase())
      )
    );
  }
  return event;
};

/** The initialised SDK, `null` where Sentry is off; one per function instance */
let sdk;

/** The same SDK once it has loaded, for code that cannot wait on `sdk` */
let loaded;

/**
 * Reports an error a handler has already answered, as the routes that turn a
 * driver failure into a generic 500 do. An error that escapes the handler is
 * captured by `withObservability` itself; do not report it twice. Does nothing
 * where Sentry is off.
 *
 * @param {unknown} error
 */
export const captureServerError = (error) => {
  loaded?.captureException(error);
};

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
      sendDefaultPii: false,
      beforeSend: scrubEvent,
      // A request the browser already traces keeps the browser's decision
      tracesSampler: ({ inheritOrSampleWith }) => inheritOrSampleWith(rate),
      // `withObservability` names each request's span by route; the SDK's own
      // incoming-request span would be a second, unnamed trace per request
      integrations: [
        Sentry.httpIntegration({ disableIncomingRequestSpans: true }),
      ],
    });
    return (loaded = Sentry);
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
