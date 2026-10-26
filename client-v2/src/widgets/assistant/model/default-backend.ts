import { useEffect, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
// TODO(hoodieshq): move DEFAULT_BACKEND_URL into widgets/assistant; a widget must not import from a legacy view
import { DEFAULT_BACKEND_URL } from "../../../views/sidebar/assistant/config";
import { assistantTelemetry } from "./telemetry";
import type { AssistantEvents } from "./telemetry";

const log = createLogger("assistant:connect");

/** What the deployment's keyless default backend answered */
export type DefaultBackend =
  | { state: "checking" }
  | { state: "absent" }
  /**
   * The asking failed, so whether there is a default is not known: nothing
   * offers it, and a send asks again rather than taking the deployment for
   * one without
   */
  | { state: "unreachable" }
  | { state: "present"; model: string | null };

/** Why a probe failed: the request, the status or the body */
type ProbeFailure = AssistantEvents["assistant_default_probe_failed"]["reason"];

/**
 * What one request answered. A failure is the answer for its own callers
 * only: the next one asks again, so a blip on load does not hide the default
 * for the rest of the page.
 */
type Asked = { backend: DefaultBackend; failed: boolean };

let probe: Promise<DefaultBackend> | undefined;

/** Test-only: forget the cached answer so the next probe asks again */
export const resetDefaultBackendProbe = () => {
  probe = undefined;
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

const ask = async (): Promise<Asked> => {
  let res: Response;
  try {
    res = await fetch(DEFAULT_BACKEND_URL);
  } catch (error) {
    return failed("network", error);
  }
  if (res.status === 404) {
    // A deployment without `/api/agent` (a fork, a static host): there is no
    // default to offer, and nothing for the team to hear of, since the user's
    // own key still works. Not a failure, so not `assistant_default_probe_failed`
    log.warn("this deployment serves no default backend", {
      context: { status: res.status },
    });
    return answered({ state: "absent" });
  }
  if (!res.ok) {
    return failed(
      "status",
      new Error(`GET ${DEFAULT_BACKEND_URL}: ${res.status}`)
    );
  }

  let body: { configured?: unknown; model?: unknown } | null;
  try {
    body = await res.json();
  } catch (error) {
    return failed("body", error);
  }
  if (typeof body?.configured !== "boolean") {
    return failed("body", new Error("No boolean `configured` in the answer"));
  }
  if (!body.configured) return answered({ state: "absent" });
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
 * Ask the server whether its default backend is configured, and with which
 * model: once per page, unless the asking fails, when the next caller asks
 * again.
 */
export const probeDefaultBackend = (): Promise<DefaultBackend> => {
  if (probe) return probe;
  const current: Promise<DefaultBackend> = ask().then(
    ({ backend, failed }) => {
      if (failed && probe === current) probe = undefined;
      return backend;
    },
    (error: unknown) => {
      if (probe === current) probe = undefined;
      throw error;
    }
  );
  probe = current;
  return current;
};

export const useDefaultBackend = (): DefaultBackend => {
  const [backend, setBackend] = useState<DefaultBackend>({ state: "checking" });

  useEffect(() => {
    let live = true;
    probeDefaultBackend().then(
      (answer) => {
        if (live) setBackend(answer);
      },
      (error: unknown) => {
        // The probe answers its own failures, so this is a bug past them;
        // without an answer the default is not offered
        log.error(error, { report: true, context: { reason: "hook" } });
        if (live) setBackend({ state: "unreachable" });
      }
    );
    return () => {
      live = false;
    };
  }, []);

  return backend;
};
