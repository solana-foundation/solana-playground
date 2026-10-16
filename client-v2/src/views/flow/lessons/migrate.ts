import { admits, foldRecord } from "./ledger";
import { nextSeq } from "./events";
import type { LessonRecordEvent, StoredLesson } from "./events";
import { graderClass } from "./verify";
import type { LessonPath } from "./types";

/** The record shape #19 shipped: three fields, no provenance */
export interface LessonProgressV1 {
  completedStepIds: string[];
  skippedStepIds?: string[];
  currentStepId: string | null;
}

export const isV1 = (raw: unknown): raw is LessonProgressV1 => {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    Array.isArray(r.completedStepIds) &&
    (r.currentStepId === null || typeof r.currentStepId === "string")
  );
};

const MARKS = ["open", "proved", "attested", "passed"];

// The fold consumes the snapshot unguarded (`new Map(marks)`,
// `new Set(opened)`), so a malformed one must fail here, into the load's
// `loadFailed` refusal, rather than crash or fold garbage
const isSnapshot = (raw: unknown): boolean => {
  if (typeof raw !== "object" || raw === null) return false;
  const s = raw as Record<string, unknown>;
  return (
    Array.isArray(s.marks) &&
    s.marks.every(
      (m) =>
        Array.isArray(m) && typeof m[0] === "string" && MARKS.includes(m[1])
    ) &&
    typeof s.cursor === "string" &&
    (s.opened === undefined ||
      (Array.isArray(s.opened) &&
        s.opened.every((id) => typeof id === "string")))
  );
};

// The fold walks events just as unguarded (`ev.type`, `for (const id of
// ev.stepIds)`), and the first fold runs outside the load's try -- a
// malformed element must fail here, not as an unhandled rejection
const isEvent = (raw: unknown): boolean => {
  if (typeof raw !== "object" || raw === null) return false;
  const e = raw as Record<string, unknown>;
  if (typeof e.seq !== "number") return false;
  if (e.at !== null && typeof e.at !== "number") return false;
  if (typeof e.actor !== "string") return false;

  switch (e.type) {
    case "enter":
      return true;
    case "graded":
      return (
        Array.isArray(e.stepIds) &&
        e.stepIds.every((id) => typeof id === "string")
      );
    case "checked":
    case "pass":
    case "attest":
    case "opened":
      return typeof e.stepId === "string";
    case "move":
      return typeof e.to === "string";
    case "attempt":
      return typeof e.startedAt === "number";
    case "hint":
      return typeof e.stepId === "string" && typeof e.rung === "number";
    default:
      return false;
  }
};

export const isV2 = (raw: unknown): raw is StoredLesson => {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    r.v === 2 &&
    Array.isArray(r.events) &&
    r.events.every(isEvent) &&
    (r.snapshot === undefined || isSnapshot(r.snapshot))
  );
};

/**
 * Replay a v1 record into events, once.
 *
 * The mapping is per kind, not per field, because v1's
 * `completedStepIds` is exactly the field that conflated the two: an
 * id there whose step is an attestation kind was necessarily put there
 * by a click, so it migrates to `attested`; every other id migrates to
 * `proved`; skips migrate to `passed`. Every synthesized event carries
 * `at: null` and `actor: "unknown"`, so the record never claims
 * provenance it does not have.
 *
 * Events are appended through the same `admits` guard live dispatch
 * uses, which is what collapses D-b's duplicate ids on the way in: the
 * second event for a step whose mark is already terminal has no edge
 * to travel on, so it is never written.
 */
export const migrateV1 = (
  path: LessonPath,
  v1: LessonProgressV1
): StoredLesson => {
  let record: StoredLesson = { v: 2, events: [] };

  type MigratedPayload =
    | { type: "graded"; stepIds: string[] }
    | { type: "attest"; stepId: string }
    | { type: "pass"; stepId: string }
    | { type: "move"; to: string | "end" };

  const append = (ev: MigratedPayload) => {
    const candidate = {
      ...ev,
      seq: nextSeq(record),
      at: null,
      actor: "unknown",
    } as LessonRecordEvent;
    if (!admits(path, foldRecord(path, record), candidate)) return;
    record = { v: 2, events: [...record.events, candidate] };
  };

  // Walk the path in order so the frontier guards hold while replaying:
  // by the time a skipped or attested step is reached, everything
  // before it is already non-open
  for (const step of path.steps) {
    for (const id of v1.completedStepIds) {
      if (id !== step.id) continue;
      if (graderClass(step.verify) === "attestation") {
        append({ type: "attest", stepId: step.id });
      } else {
        append({ type: "graded", stepIds: [step.id] });
      }
    }
    if ((v1.skippedStepIds ?? []).includes(step.id)) {
      // v1 offered its skip on any kind; on an attestation step the
      // click means the same thing `attest` does, and `pass` would be
      // refused by the fold, silently re-opening the step
      if (graderClass(step.verify) === "attestation") {
        append({ type: "attest", stepId: step.id });
      } else {
        append({ type: "pass", stepId: step.id });
      }
    }
  }

  if (v1.currentStepId !== null) {
    append({ type: "move", to: v1.currentStepId });
  }

  return record;
};
