import { EMPTY_STORED, nextSeq } from "./events";
import type { LessonRecordEvent, StoredLesson } from "./events";

const attempt = (seq: number): LessonRecordEvent => ({
  seq,
  at: seq * 1000,
  actor: "learner",
  type: "attempt",
  startedAt: seq,
});

const record = (events: LessonRecordEvent[]): StoredLesson => ({
  v: 2,
  events,
});

describe("EMPTY_STORED", () => {
  it("is frozen -- the load path detects a failed read by identity against it", () => {
    expect(Object.isFrozen(EMPTY_STORED)).toBe(true);
    expect(Object.isFrozen(EMPTY_STORED.events)).toBe(true);
  });
});

describe("nextSeq", () => {
  it("starts a fresh record at 1", () => {
    expect(nextSeq(EMPTY_STORED)).toBe(1);
  });

  it("continues from the last event", () => {
    expect(nextSeq(record([attempt(1), attempt(2)]))).toBe(3);
  });
});
