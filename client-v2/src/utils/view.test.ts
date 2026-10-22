import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLogs,
  resetLogger,
} from "@/shared/lib/logger";
import { PgCommon } from "./common";
import { MODAL_HOST_WAIT, PgView } from "./view";

const names = PgCommon.getStaticStateEventNames(
  PgView.events.MAIN_PRIMARY_STATIC
);
const { send, receive } = PgCommon.getSendAndReceiveEventNames(names.get);

let cleanup: Array<() => void> = [];
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  cleanup.forEach((c) => c());
  cleanup = [];
  resetLogger();
});

/** Let the pending `get` requests and their answers run */
const settle = () => PgCommon.sleep(10);

/**
 * Stands in for `Primary`: answers `get`, records what each `set` carried
 * and announces its mount once listening, as `Primary` does. The answer
 * comes after a tick, as `useSendAndReceiveCustomEvent` answers, so the
 * requester is already listening for it.
 */
const mountPrimary = () => {
  const received: unknown[] = [];
  const onGet = async () => {
    await PgCommon.sleep(0);
    PgCommon.createAndDispatchCustomEvent(receive, { data: null });
  };
  const onSet = (ev: Event) => received.push((ev as CustomEvent).detail);
  document.addEventListener(send, onGet);
  document.addEventListener(names.set, onSet);
  cleanup.push(() => {
    document.removeEventListener(send, onGet);
    document.removeEventListener(names.set, onSet);
  });
  PgView.announceMainPrimaryMount();
  return received;
};

it("sets the view once when it mounts after the call", async () => {
  const done = PgView.setMainPrimary(() => null);
  // Nothing mounted: the call waits for the mount
  await settle();
  const sets = mountPrimary();
  await done;
  await settle();
  expect(sets).toHaveLength(1);
});

it("sets the view once when it is already mounted", async () => {
  const sets = mountPrimary();
  await PgView.setMainPrimary(() => null);
  expect(sets).toHaveLength(1);
});

it("sets only the newest view when several routes waited for a mount", async () => {
  // Home keeps the main view unmounted: the "/" route asks first, then the
  // route the user opened from Home
  const older = () => null;
  const newer = () => null;
  const first = PgView.setMainPrimary(older);
  await settle();
  const second = PgView.setMainPrimary(newer);
  await settle();
  const sets = mountPrimary();
  await Promise.all([first, second]);
  await settle();
  expect(sets).toHaveLength(1);
  expect(sets[0]).toBe(newer);
});

it("sets only the newest view when two routes ask while one is mounted", async () => {
  const sets = mountPrimary();
  const older = () => null;
  const newer = () => null;
  await Promise.all([
    PgView.setMainPrimary(older),
    PgView.setMainPrimary(newer),
  ]);
  // Each call's `get` is answered; let the later answer land here
  await settle();
  expect(sets).toEqual([newer]);
});

it("waits with one listener for the answer while nothing is mounted", async () => {
  const added: string[] = [];
  const addEventListener = document.addEventListener.bind(document);
  const spy = vi
    .spyOn(document, "addEventListener")
    .mockImplementation((type, listener, options) => {
      added.push(type);
      addEventListener(type, listener, options);
    });
  cleanup.push(() => spy.mockRestore());

  const done = PgView.setMainPrimary(() => null);
  await settle();
  const waiting = added.filter((type) => type === receive).length;
  const sets = mountPrimary();
  await done;
  expect(waiting).toBeLessThanOrEqual(1);
  expect(sets).toHaveLength(1);
});

it("reports the getter's error and sets nothing instead of waiting for a mount", async () => {
  const onGet = async () => {
    await PgCommon.sleep(0);
    PgCommon.createAndDispatchCustomEvent(receive, { error: "broken view" });
  };
  document.addEventListener(send, onGet);
  cleanup.push(() => document.removeEventListener(send, onGet));

  const set = vi.fn();
  document.addEventListener(names.set, set);
  cleanup.push(() => document.removeEventListener(names.set, set));

  await PgView.setMainPrimary(() => null);
  expect(set).not.toHaveBeenCalled();
  expect(logged.entries).toHaveLength(1);
  expect(logged.entries[0].ns).toBe("view:main-primary");
  expect(logged.entries[0].report).toBe(true);
  expect(String(logged.entries[0].error)).toContain("broken view");
});

// Modals

const PENDING = "pending";

/** What `promise` has settled to by the time queued microtasks have run */
const settled = async (promise: Promise<unknown>) =>
  Promise.race([promise, PgCommon.sleep(0).then(() => PENDING)]);

const Dialog = () => null;

afterEach(() => {
  vi.useRealTimers();
  resetLogger();
  vi.restoreAllMocks();
  // Dialogs a test leaves open would otherwise sit under the next test's
  for (const { id } of PgView.getOpenModals()) PgView.closeModal(null, id);
});

it("should answer only the top dialog when a stacked one closes", async () => {
  const lower = PgView.setModal(Dialog);
  const upper = PgView.setModal(Dialog);

  PgView.closeTopModal("upper's answer");

  await expect(settled(upper)).resolves.toBe("upper's answer");
  await expect(settled(lower)).resolves.toBe(PENDING);

  PgView.closeTopModal("lower's answer");

  await expect(settled(lower)).resolves.toBe("lower's answer");
});

it("should leave no document listener behind once its dialog closes", async () => {
  const added = vi.spyOn(document, "addEventListener");
  const removed = vi.spyOn(document, "removeEventListener");

  const answer = PgView.setModal(Dialog);
  PgView.closeTopModal();
  await answer;

  expect(added.mock.calls.length).toBe(removed.mock.calls.length);
});

it("should close the dialog with the given id, not the one on top", async () => {
  const lower = PgView.openModal(Dialog);
  const upper = PgView.openModal(Dialog);

  PgView.closeModal("lower's answer", lower.id);

  await expect(settled(lower.answer)).resolves.toBe("lower's answer");
  await expect(settled(upper.answer)).resolves.toBe(PENDING);
  expect(PgView.getOpenModals().map((modal) => modal.id)).toEqual([upper.id]);
});

it("should answer no one when the dialog with the given id is already closed", async () => {
  const closed = PgView.openModal(Dialog);
  PgView.closeModal("first", closed.id);
  const open = PgView.openModal(Dialog);

  PgView.closeModal("second", closed.id);

  await expect(settled(closed.answer)).resolves.toBe("first");
  await expect(settled(open.answer)).resolves.toBe(PENDING);
});

it("should answer no one and not throw when nothing is open", () => {
  expect(() => PgView.closeTopModal("stray")).not.toThrow();
  expect(PgView.getOpenModals()).toEqual([]);
});

it("should answer null when dismissed with no answer", async () => {
  const answer = PgView.setModal(Dialog);

  PgView.closeTopModal();

  await expect(settled(answer)).resolves.toBeNull();
});

it("should close with null and report a dialog no host shows in time", async () => {
  vi.useFakeTimers();
  const logs = memoryLogs();
  initLogger({ providers: [logs] });
  const answer = PgView.setModal(Dialog);

  await vi.advanceTimersByTimeAsync(MODAL_HOST_WAIT);

  await expect(answer).resolves.toBeNull();
  expect(PgView.getOpenModals()).toEqual([]);
  expect(
    logs.entries.map((entry) => ({ ns: entry.ns, report: entry.report }))
  ).toEqual([{ ns: "view:modal", report: true }]);
  expect(logs.entries[0].context).toEqual({ modal: "Dialog" });
});

it("should keep a dialog open for a host that mounts in time", async () => {
  vi.useFakeTimers();
  const answer = PgView.setModal(Dialog);

  await vi.advanceTimersByTimeAsync(MODAL_HOST_WAIT - 1);
  const host = PgView.attachModalHost();
  await vi.advanceTimersByTimeAsync(MODAL_HOST_WAIT);

  expect(PgView.getOpenModals().length).toBe(1);
  host.dispose();
  PgView.closeTopModal("shown");
  await expect(answer).resolves.toBe("shown");
});

it("should close the dialogs a host leaves behind when no host comes back", async () => {
  vi.useFakeTimers();
  const host = PgView.attachModalHost();
  const answer = PgView.setModal(Dialog);

  host.dispose();
  await vi.advanceTimersByTimeAsync(MODAL_HOST_WAIT);

  await expect(answer).resolves.toBeNull();
});

it("should wait in full again for a host that came and went", async () => {
  vi.useFakeTimers();
  const first = PgView.attachModalHost();
  const answer = PgView.setModal(Dialog);
  first.dispose();

  await vi.advanceTimersByTimeAsync(1000);
  PgView.attachModalHost().dispose();
  await vi.advanceTimersByTimeAsync(MODAL_HOST_WAIT - 1000);

  expect(PgView.getOpenModals().length).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  await expect(answer).resolves.toBeNull();
});
