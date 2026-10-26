import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLogs,
  resetLogger,
} from "@/shared/lib/logger";
import { PgCommon } from "./common";

// What `PgView` delivered and to how many mounted views is module state; a
// fresh module per test keeps one test's delivery out of the next one's mount
let PgView: typeof import("./view").PgView;
beforeEach(async () => {
  vi.resetModules();
  ({ PgView } = await import("./view"));
  initLogger({ providers: [memoryLogs()] });
});

let cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.forEach((c) => c());
  cleanup = [];
  resetLogger();
});

const settle = () => PgCommon.sleep(10);

/**
 * Stands in for `Primary`: answers `get` (with `error` when given), records
 * what each `set` carried, and announces its mount and, through `unmount`,
 * its unmount, as `Primary` does. `afterAnswer` runs right after the answer
 * goes out, before the caller can send `set`.
 */
const mount = (opts: { error?: string; afterAnswer?: () => void } = {}) => {
  const names = PgCommon.getStaticStateEventNames(
    PgView.events.MAIN_PRIMARY_STATIC
  );
  const { send, receive } = PgCommon.getSendAndReceiveEventNames(names.get);
  const sets: unknown[] = [];
  const onGet = async () => {
    await PgCommon.sleep(0);
    PgCommon.createAndDispatchCustomEvent(
      receive,
      opts.error ? { error: opts.error } : { data: null }
    );
    opts.afterAnswer?.();
  };
  const onSet = (ev: Event) => sets.push((ev as CustomEvent).detail);
  document.addEventListener(send, onGet);
  document.addEventListener(names.set, onSet);
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    document.removeEventListener(send, onGet);
    document.removeEventListener(names.set, onSet);
    PgView.announceMainPrimaryUnmount();
  };
  cleanup.push(unmount);
  PgView.announceMainPrimaryMount();
  return { sets, unmount };
};

it("gives a view that mounts again the content delivered before", async () => {
  const view = () => null;
  const first = mount();
  await PgView.setMainPrimary(view);
  expect(first.sets).toEqual([view]);
  first.unmount();

  const second = mount();
  await settle();
  expect(second.sets).toEqual([view]);
});

it("gives a waiting call's content only, not the old one too", async () => {
  const older = () => null;
  const newer = () => null;
  const first = mount();
  await PgView.setMainPrimary(older);
  first.unmount();
  const done = PgView.setMainPrimary(newer);
  await settle();

  const second = mount();
  await done;
  await settle();
  expect(second.sets).toEqual([newer]);
});

it("does not give the content twice to views that stay mounted", async () => {
  const view = () => null;
  const first = mount();
  await PgView.setMainPrimary(view);
  first.unmount();
  const second = mount();
  await settle();
  const third = mount();
  await settle();
  expect(second.sets).toEqual([view]);
  expect(third.sets).toEqual([]);
});

it("gives the content to the next view when the one asked unmounted before it arrived", async () => {
  const view = () => null;
  // The view answers, then unmounts before the content is sent: no view
  // holds it, so the next one must get it
  const first = mount({ afterAnswer: () => first.unmount() });
  await PgView.setMainPrimary(view);
  expect(first.sets).toEqual([]);

  const second = mount();
  await settle();
  expect(second.sets).toEqual([view]);
});

it("still gives the content back after a call whose view failed to answer", async () => {
  const broken = mount({ error: "broken view" });
  await PgView.setMainPrimary(() => null);
  broken.unmount();

  const view = () => null;
  const first = mount();
  await PgView.setMainPrimary(view);
  first.unmount();
  const second = mount();
  await settle();
  expect(second.sets).toEqual([view]);
});
