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
 * the user, and the breadcrumbs. A second line behind `dataCollection` in
 * `loadSentry`, which keeps request data off events and spans alike; spans are
 * not passed to `beforeSend`.
 *
 * @template {import("@sentry/node").ErrorEvent} E
 * @param {E} event
 * @returns {E}
 */
export const scrubEvent = (event) => {
  delete event.user;
  // `console.*` calls land here with their raw arguments, and the handlers log
  // upstream bodies and driver details on purpose
  delete event.breadcrumbs;
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

/**
 * A copy of `error` that is safe to send: a `pg` error's message echoes
 * values of the request (an invalid input, a duplicate key) and a connection
 * failure's names the host, so only its code and constraint stay, with the
 * original stack. Anything else goes as it is.
 *
 * @param {unknown} error
 */
const sendable = (error) => {
  const code = /** @type {{ code?: unknown }} */ (error)?.code;
  // A SQLSTATE is five characters; a Node system error's code (ECONNRESET) is not one
  if (!(error instanceof Error) || !/^[0-9A-Z]{5}$/.test(String(code))) {
    return error;
  }
  const constraint = /** @type {{ constraint?: unknown }} */ (error).constraint;
  const safe = new Error(
    `database error ${code}${
      typeof constraint === "string" ? ` (${constraint})` : ""
    }`
  );
  safe.stack = error.stack?.replace(error.message, safe.message);
  return safe;
};

/** The initialised SDK, `null` where Sentry is off; one per function instance */
let sdk;

/** The same SDK once it has loaded, for code that cannot wait on `sdk` */
let loaded;

/**
 * Reports an error a handler answers with a 500 itself (a driver failure, a
 * broken catalogue), as the routes do just before they respond. An error that escapes the handler is
 * captured by `withObservability` itself; do not report it twice. Does nothing
 * where Sentry is off.
 *
 * @param {unknown} error
 */
export const captureServerError = (error) => {
  loaded?.captureException(sendable(error));
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
