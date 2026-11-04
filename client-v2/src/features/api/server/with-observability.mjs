// Observability for the API functions: one `http.server` span per request,
// errors captured, flushed before the function returns, and the server
// logger's reported entries routed to Sentry. Sentry is the provider, and
// runs only where the browser reports too (`sentryEnabled`); elsewhere
// `@sentry/node` is never imported.
import { sentryEnabled } from "../../../../scripts/sentry-gate.mjs";
import { sentryEnv } from "../../../shared/config/server-env.mjs";
import {
  createServerLogger,
  initServerLogger,
  sentryServerProvider,
  serverConsoleProvider,
} from "../../../shared/lib/logger/server.mjs";

const log = createServerLogger("api:observability");

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
  log.warn(
    `SENTRY_TRACES_SAMPLE_RATE=${value} is not a rate from 0 to 1; using 1`
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

/** A SQLSTATE is five characters; a Node system error's code (ECONNRESET) is not one */
const isDatabaseError = (error) =>
  error instanceof Error &&
  /^[0-9A-Z]{5}$/.test(String(/** @type {{ code?: unknown }} */ (error).code));

/** @param {Error & { code?: unknown; constraint?: unknown }} error */
const databaseSummary = ({ code, constraint }) =>
  `database error ${code}${
    typeof constraint === "string" ? ` (${constraint})` : ""
  }`;

/**
 * Rewrites the exception value of each database error in the chain of
 * `hint.originalException` to its code and constraint: a `pg` error's message
 * echoes values of the request (an invalid input, a duplicate key) and a
 * connection failure's names the host. Values are matched by text, which
 * holds because `loadSentry` sets no `maxValueLength`; stack frames carry no
 * message. The routes still print the whole error to the function log.
 *
 * @param {import("@sentry/node").ErrorEvent} event
 * @param {import("@sentry/node").EventHint | undefined} hint
 */
const summariseDatabaseErrors = (event, hint) => {
  const values = event.exception?.values;
  if (!values) return;
  /** @type {Map<string, string>} */
  const summaries = new Map();
  const seen = new Set();
  for (
    let error = hint?.originalException;
    error instanceof Error && !seen.has(error);
    error = error.cause
  ) {
    seen.add(error);
    if (isDatabaseError(error)) {
      summaries.set(error.message, databaseSummary(error));
    }
  }
  for (const value of values) {
    const summary = value.value && summaries.get(value.value);
    if (summary) value.value = summary;
  }
};

/**
 * What leaves the function on an event: never a body, a cookie, the query
 * string (an OAuth callback carries its `code` there), a header outside
 * `KEPT_HEADERS` (`authorization`, and the key headers a client may send), the
 * user, the breadcrumbs, or a database error's message. Every event passes
 * here, the server logger's `report: true` entries (`sentryServerProvider`)
 * and the errors `withObservability` catches alike. A second line behind
 * `dataCollection` in `loadSentry`, which keeps request data off events and
 * spans alike; spans are not passed to `beforeSend`.
 *
 * @template {import("@sentry/node").ErrorEvent} E
 * @param {E} event
 * @param {import("@sentry/node").EventHint} hint
 * @returns {E}
 */
export const scrubEvent = (event, hint) => {
  delete event.user;
  // The console provider prints every field of a logged error (a driver's
  // `detail` among them), and console calls land here as breadcrumbs
  delete event.breadcrumbs;
  summariseDatabaseErrors(event, hint);
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

/** The text of an attribute, whether the SDK holds it raw or as `{ value }` */
const attributeText = (attribute) =>
  typeof attribute === "object" && attribute !== null
    ? attribute.value
    : attribute;

/**
 * What leaves on a streamed span: outgoing requests (AI providers, MCP
 * upstreams) carry their URL, and an MCP source may keep a credential in its
 * query string, so `url.query` goes and `url.full` and `http.url` lose theirs.
 * Spans are not passed to `beforeSend`.
 *
 * @param {import("@sentry/node").StreamedSpanJSON} span
 * @returns {import("@sentry/node").StreamedSpanJSON}
 */
export const scrubSpan = (span) => {
  const attributes = span.attributes;
  delete attributes["url.query"];
  delete attributes["http.query"];
  for (const key of ["url.full", "http.url"]) {
    const text = attributeText(attributes[key]);
    if (typeof text === "string") attributes[key] = text.split(/[?#]/)[0];
  }
  return span;
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
      // v11 collects everything unless told not to (`sendDefaultPii` is gone):
      // bodies, headers, cookies, query strings and IPs ride on spans as well
      // as events, and `beforeSend` sees events only
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
      },
      beforeSend: scrubEvent,
      beforeSendSpan: scrubSpan,
      // A request the browser already traces keeps the browser's decision
      tracesSampler: ({ inheritOrSampleWith }) => inheritOrSampleWith(rate),
      // `withObservability` names each request's span by route; the SDK's own
      // incoming-request span would be a second, unnamed trace per request
      integrations: [
        // `dataCollection` alone leaves the request body on the segment span
        Sentry.requestDataIntegration({
          include: {
            cookies: false,
            data: false,
            headers: false,
            ip: false,
            query_string: false,
            url: false,
          },
        }),
        Sentry.httpIntegration({ disableIncomingRequestSpans: true }),
      ],
    });
    initServerLogger({
      providers: [serverConsoleProvider(), sentryServerProvider(Sentry)],
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
