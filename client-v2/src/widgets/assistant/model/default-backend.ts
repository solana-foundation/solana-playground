import { useEffect, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { assistantTelemetry } from "./telemetry";
import type { AssistantEvents } from "./telemetry";
import { assistantTelemetry } from "./telemetry";

const log = createLogger("assistant:connect");

/** Where the client learns whether this deployment offers a hosted model */
export const AI_STATUS_URL = "/api/ai/status";

/** What the deployment's keyless default backend answered */
export type DefaultBackend =
  | { state: "checking" }
  | { state: "absent" }
  /**
   * The asking failed, or the server could not read the caller's session, so
   * whether there is a default is not known: nothing offers it, and the off
   * row's Try again, or any later probe, asks again rather than taking the
   * deployment for one without
   */
  | { state: "unreachable" }
  | { state: "present"; model: string | null };

/** Why a probe failed: the request, the status, the body or the session */
type ProbeFailure = AssistantEvents["assistant_default_probe_failed"]["reason"];

/**
 * What one request answered. A failure is the answer for its own callers
 * only: the next one asks again, so a blip on load does not hide the default
 * for the rest of the page.
 */
type Asked = { backend: DefaultBackend; failed: boolean };

let probe: Promise<DefaultBackend> | undefined;

/** The retry under way, which a second Try again joins */
let retrying: Promise<DefaultBackend> | undefined;

/**
 * How many answers have been handed out, so a reader holding the promise of
 * an earlier request can tell that a newer answer reached it already
 */
let answers = 0;

/** Readers of every settled answer, a retry's included: each `useDefaultBackend` */
const listeners = new Set<(backend: DefaultBackend) => void>();

/**
 * Hand an answer to every reader. One that throws is reported and skipped,
 * so it neither keeps the answer from the rest nor fails the probe.
 */
const broadcast = (backend: DefaultBackend) => {
  answers += 1;
  listeners.forEach((listener) => {
    try {
      listener(backend);
    } catch (error) {
      log.error(error, { report: true, context: { reason: "listener" } });
    }
  });
};

/** Test-only: forget the cached answer so the next probe asks again */
export const resetDefaultBackendProbe = () => {
  probe = undefined;
  retrying = undefined;
};

const failed = (reason: ProbeFailure, error: unknown): Asked => {
  log.error(error, { report: true, context: { reason } });
  assistantTelemetry.track("assistant_default_probe_failed", { reason });
  return { backend: { state: "unreachable" }, failed: true };
};

const answered = (backend: DefaultBackend): Asked => ({
  backend,
  failed: false,
});

/** `GET /api/ai/status`'s body, as far as the probe reads it */
type StatusBody = { key?: unknown; reason?: unknown; model?: unknown };

const ask = async (): Promise<Asked> => {
  let res: Response;
  try {
    res = await fetch(AI_STATUS_URL);
  } catch (error) {
    return failed("network", error);
  }
  if (res.status === 404) {
    // A deployment without the route (a fork, a static host): there is no
    // default to offer, and nothing for the team to hear of, since the user's
    // own key still works. Not a failure, so not `assistant_default_probe_failed`
    log.warn("this deployment serves no AI status", {
      context: { status: res.status },
    });
    return answered({ state: "absent" });
  }
  if (!res.ok) {
    return failed("status", new Error(`GET ${AI_STATUS_URL}: ${res.status}`));
  }

  let body: StatusBody | null;
  try {
    body = await res.json();
  } catch (error) {
    return failed("body", error);
  }
  if (body?.key === "own") return answered({ state: "absent" });
  if (body?.key !== "hosted") {
    return failed("body", new Error("No known `key` in the answer"));
  }
  if (body.reason === "unavailable") {
    // The route could not read the session and has logged why; telling the
    // user to sign in would not help, so the default reads as unreachable and
    // the next caller asks again. Counted, not reported a second time
    log.warn("the server could not read the session for the AI status");
    assistantTelemetry.track("assistant_default_probe_failed", {
      reason: "session",
    });
    return { backend: { state: "unreachable" }, failed: true };
  }
  if (typeof body.model === "string") {
    return answered({ state: "present", model: body.model });
  }
  if (body.model !== null && body.model !== undefined) {
    // The default still answers; the composer shows "Default model" instead
    // of its name, which is worth a look but not a report
    log.warn("the default backend's model is not a string", {
      context: { type: typeof body.model },
    });
  }
  return answered({ state: "present", model: null });
};

/**
 * Ask `GET /api/ai/status` whether this deployment offers its hosted model,
 * and which: once per page, unless the asking fails, when the next caller
 * asks again. Whether this user may spend it is the page's session's to say.
 */
export const probeDefaultBackend = (): Promise<DefaultBackend> => {
  if (probe) return probe;
  // Only the latest request speaks to the readers: one a retry replaced
  // answers its own callers, never over the retry's answer
  const current: Promise<DefaultBackend> = ask().then(
    ({ backend, failed }) => {
      if (probe !== current) return backend;
      if (failed) probe = undefined;
      broadcast(backend);
      return backend;
    },
    (error: unknown) => {
      if (probe !== current) throw error;
      probe = undefined;
      // A bug past the probe's own failures: without an answer the default
      // is not offered, and every reader says so
      broadcast({ state: "unreachable" });
      throw error;
    }
  );
  probe = current;
  return current;
};

/**
 * Ask again, whatever the page holds: the off row's Try again. Every
 * `useDefaultBackend` takes the new answer.
 */
export const retryDefaultBackend = (): Promise<DefaultBackend> => {
  if (retrying) return retrying;
  assistantTelemetry.track("assistant_default_probe_retried", {});
  probe = undefined;
  const current = probeDefaultBackend().finally(() => {
    if (retrying === current) retrying = undefined;
  });
  retrying = current;
  return current;
};

export const useDefaultBackend = (): DefaultBackend => {
  const [backend, setBackend] = useState<DefaultBackend>({ state: "checking" });

  useEffect(() => {
    let live = true;
    const take = (answer: DefaultBackend) => {
      if (live) setBackend(answer);
    };
    listeners.add(take);
    // A page that already holds an answer hands it out here; otherwise the
    // broadcast does, and this one stands down for whatever it delivered
    const seen = answers;
    probeDefaultBackend().then(
      (answer) => {
        if (answers === seen) take(answer);
      },
      (error: unknown) => {
        // The probe answers its own failures, so this is a bug past them;
        // without an answer the default is not offered
        log.error(error, { report: true, context: { reason: "hook" } });
        take({ state: "unreachable" });
      }
    );
    return () => {
      live = false;
      listeners.delete(take);
    };
  }, []);

  return backend;
};
