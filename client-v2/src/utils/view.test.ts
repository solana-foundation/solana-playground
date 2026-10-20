import { afterEach, expect, it, vi } from "vitest";

import { PgCommon } from "./common";
import { PgView } from "./view";

const names = PgCommon.getStaticStateEventNames(
  PgView.events.MAIN_PRIMARY_STATIC
);
const { send, receive } = PgCommon.getSendAndReceiveEventNames(names.get);

let cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.forEach((c) => c());
  cleanup = [];
});

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

it("sets the view once when it mounts after several attempts", async () => {
  const done = PgView.setMainPrimary(() => null);
  // Nothing mounted: about four attempts time out and keep waiting
  await PgCommon.sleep(450);
  const sets = mountPrimary();
  await done;
  await PgCommon.sleep(150);
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
  await PgCommon.sleep(250);
  const second = PgView.setMainPrimary(newer);
  await PgCommon.sleep(250);
  const sets = mountPrimary();
  await Promise.all([first, second]);
  await PgCommon.sleep(150);
  expect(sets).toHaveLength(1);
  expect(sets[0]).toBe(newer);
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
  await PgCommon.sleep(1000);
  const waiting = added.filter((type) => type === receive).length;
  const sets = mountPrimary();
  await done;
  expect(waiting).toBeLessThanOrEqual(1);
  expect(sets).toHaveLength(1);
});

it("rejects with the getter's error instead of waiting for a mount", async () => {
  const onGet = async () => {
    await PgCommon.sleep(0);
    PgCommon.createAndDispatchCustomEvent(receive, { error: "broken view" });
  };
  document.addEventListener(send, onGet);
  cleanup.push(() => document.removeEventListener(send, onGet));

  await expect(PgView.setMainPrimary(() => null)).rejects.toThrow(
    "broken view"
  );
});
