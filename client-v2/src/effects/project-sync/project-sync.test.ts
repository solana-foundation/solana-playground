import { projectSync } from "./project-sync";
import { PgProjectSync } from "../../features/persistence/model/project-sync";
import { PgCommon } from "../../utils/common";
import { PgExplorer } from "../../utils/explorer/explorer";

/**
 * What this effect subscribes to is the whole of its job.
 *
 * It was subscribed to file changes alone, so a project reached the server
 * only by being typed in: opening one, or signing in with one already open,
 * left it on this device however long you looked at it. That is not visible in
 * a test of `PgProjectSync`, which was correct throughout -- nothing called it.
 */

const dispatch = (event: string) =>
  PgCommon.createAndDispatchCustomEvent(event);

describe("the project-sync effect", () => {
  let push: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    push = jest
      .spyOn(PgProjectSync, "pushCurrent")
      .mockResolvedValue("ok" as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("uploads when the user opens a project, not only when they type in one", () => {
    const effect = projectSync();

    dispatch(PgExplorer.events.ON_DID_SWITCH_WORKSPACE);
    jest.advanceTimersByTime(3000);

    expect(push).toHaveBeenCalled();
    effect.dispose();
  });

  it("still uploads on an edit", () => {
    const effect = projectSync();

    dispatch(PgExplorer.events.ON_DID_SAVE_FILE);
    jest.advanceTimersByTime(3000);

    expect(push).toHaveBeenCalled();
    effect.dispose();
  });

  it("collapses a burst into one upload", () => {
    const effect = projectSync();

    dispatch(PgExplorer.events.ON_DID_SAVE_FILE);
    dispatch(PgExplorer.events.ON_DID_SAVE_FILE);
    dispatch(PgExplorer.events.ON_DID_SWITCH_WORKSPACE);
    jest.advanceTimersByTime(3000);

    expect(push).toHaveBeenCalledTimes(1);
    effect.dispose();
  });

  it("stops listening once disposed", () => {
    projectSync().dispose();

    dispatch(PgExplorer.events.ON_DID_SWITCH_WORKSPACE);
    jest.advanceTimersByTime(3000);

    expect(push).not.toHaveBeenCalled();
  });
});
