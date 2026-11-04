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

/**
 * Request headers worth keeping on an event; every other one is dropped. A
 * backstop: `requestDataIntegration` in `loadSentry` attaches no headers.
 */
const KEPT_HEADERS = new Set([
  "accept",
  "content-length",
  "content-type",
  "host",
  "user-agent",
  "x-vercel-id",
]);

/**
 * Fields of a `pg` error that quote values of the request, dropped from an
 * event's `extra` should a route ever pass one in its `context`
 */
const VALUE_FIELDS = ["detail", "hint", "where", "internalQuery"];

/**
 * A `pg` server error: a five-character SQLSTATE and the `severity` every
 * such error carries. A Node system error (`EPIPE`, `ECONNREFUSED`) has no
 * `severity`, and goes as it is.
 *
 * @param {unknown} error
 * @returns {error is Error & { code: string; constraint?: unknown }}
 */
const isDatabaseError = (error) =>
  error instanceof Error &&
  typeof (/** @type {{ severity?: unknown }} */ (error).severity) ===
    "string" &&
  /^[0-9A-Z]{5}$/.test(String(/** @type {{ code?: unknown }} */ (error).code));

/** @param {Error & { code: string; constraint?: unknown }} error */
const databaseSummary = ({ code, constraint }) =>
  `database error ${code}${
    typeof constraint === "string" ? ` (${constraint})` : ""
  }`;

/**
 * Rewrites the exception value of each database error in the chain of
 * `hint.originalException` to its code and constraint: a `pg` error's message
 * echoes values of the request (an invalid input, a duplicate key). Values
 * are matched by text, which holds because `loadSentry` sets no
 * `maxValueLength`; stack frames carry no message. A wrapper whose own
 * message quotes the driver's is not caught. The routes still print the whole
 * error to the function log.
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
 * @template {import("@sentry/node").ErrorEvent} E
 * @param {E} event
 * @param {import("@sentry/node").EventHint} hint
 * @returns {E}
 */
const scrubbed = (event, hint) => {
  delete event.user;
  // The console provider prints every field of a logged error (a driver's
  // `detail` among them), and console calls land here as breadcrumbs
  delete event.breadcrumbs;
  for (const field of VALUE_FIELDS) delete event.extra?.[field];
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

/** Said in place of every text an event carries when scrubbing it failed */
const UNSCRUBBED = "(not sent: scrubbing the event failed)";

/**
 * `event` with nothing left that `scrubbed` would have had to judge, so a
 * failure still reaches Sentry as an event with its stack.
 *
 * @template {import("@sentry/node").ErrorEvent} E
 * @param {E} event
 * @returns {E}
 */
const stripped = (event) => {
  delete event.user;
  delete event.breadcrumbs;
  delete event.request;
  delete event.extra;
  delete event.logentry;
  if (event.message !== undefined) event.message = UNSCRUBBED;
  for (const value of event.exception?.values ?? []) value.value = UNSCRUBBED;
  return event;
};

/**
 * What leaves the function on an error event: never a body, a cookie, the
 * query string (an OAuth callback carries its `code` there), a header outside
 * `KEPT_HEADERS` (`authorization`, `cookie`), the user, the breadcrumbs, a
 * `pg` error's message, or a `pg` value field in `extra`. Every error and
 * message event passes here: the server logger's `report: true` entries
 * (`sentryServerProvider`, whose `context` becomes `extra` as it is) and the
 * errors `withObservability` catches alike. A second line behind
 * `dataCollection` and `requestDataIntegration` in `loadSentry`; spans are
 * not passed to `beforeSend`. The SDK drops an event whose `beforeSend`
 * throws, so a failure here sends the event stripped and prints why.
 *
 * @template {import("@sentry/node").ErrorEvent} E
 * @param {E} event
 * @param {import("@sentry/node").EventHint} hint
 * @returns {E}
 */
export const scrubEvent = (event, hint) => {
  try {
    return scrubbed(event, hint);
  } catch (error) {
    // Printed only: reporting it would come back through this hook
    log.error(error, { context: { failed: "scrubEvent" } });
    return stripped(event);
  }
};

/** The text of an attribute, whether the SDK holds it raw or as `{ value }` */
const attributeText = (attribute) =>
  typeof attribute === "object" && attribute !== null
    ? attribute.value
    : attribute;

/** Span attributes holding a URL whose query string is dropped */
const URL_ATTRIBUTES = ["url.full", "http.url", "db.connection_string"];

/**
 * @typedef {Parameters<
 *   NonNullable<import("@sentry/node").NodeOptions["beforeSendSpan"]>
 * >[0]} StreamedSpan
 */

/**
 * What leaves on a streamed span: outgoing requests (AI providers, MCP
 * upstreams) carry their URL, and an MCP source may keep a credential in its
 * query string, so `url.query` goes and the URLs lose theirs. A database
 * span's status message is the driver's message, which `scrubEvent` keeps off
 * events, so it goes too. Spans are not passed to `beforeSend`, and the SDK
 * sends a span unchanged when this throws, so a failure drops the attributes
 * instead.
 *
 * @param {StreamedSpan} span
 * @returns {StreamedSpan}
 */
export const scrubSpan = (span) => {
  const attributes = span.attributes;
  if (!attributes) return span;
  try {
    delete attributes["url.query"];
    delete attributes["http.query"];
    for (const key of URL_ATTRIBUTES) {
      const text = attributeText(attributes[key]);
      if (typeof text === "string") attributes[key] = text.split(/[?#]/)[0];
    }
    const op = attributeText(attributes["sentry.op"]);
    if (typeof op === "string" && op.startsWith("db")) {
      delete attributes["sentry.status.message"];
    }
  } catch (error) {
    log.error(error, { context: { failed: "scrubSpan" } });
    span.attributes = {};
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
