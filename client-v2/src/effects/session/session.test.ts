import { session } from "./session";
import { PgSession } from "../../features/auth";
import { PgChatSync } from "../../features/persistence/model/chat-sync";
import { PgProjectSync } from "../../features/persistence/model/project-sync";
import * as restore from "../../features/persistence/model/project-restore";
import { PgExplorer } from "../../utils/explorer/explorer";

/**
 * The order these run in is the whole of the behaviour.
 *
 * Pushing before pulling is what gave a second browser a conflict banner for a
 * project it had simply never seen, and `restoreMissingProjects` skipping
 * anything already local is what made reloading unable to clear it.
 */

const user = { id: "u1", name: null, image: null, login: null };

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the session effect", () => {
  let calls: string[];
  let sync: jest.SpyInstance;
  let switchWorkspace: jest.SpyInstance;

  beforeEach(() => {
    calls = [];
    PgSession.reset();

    jest.spyOn(PgChatSync, "pushAll").mockImplementation(async () => {
      calls.push("pushChats");
      return true;
    });
    sync = jest
      .spyOn(restore, "syncProjectsFromServer")
      .mockImplementation(async () => {
        calls.push("pull");
        return { imported: [], replaced: [], latest: null };
      });
    jest.spyOn(PgProjectSync, "pushCurrent").mockImplementation(async () => {
      calls.push("push");
      return "ok";
    });
    jest
      .spyOn(PgProjectSync, "holdPushes")
      .mockImplementation(() => calls.push("hold"));
    jest
      .spyOn(PgProjectSync, "releasePushes")
      .mockImplementation(() => calls.push("release"));
    switchWorkspace = jest
      .spyOn(PgExplorer, "switchWorkspace")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(PgExplorer, "allWorkspaceNames", "get")
      .mockReturnValue(["Hello Anchor", "Newest"]);
    jest
      .spyOn(PgExplorer, "currentWorkspaceName", "get")
      .mockReturnValue("Hello Anchor");
    jest.spyOn(PgSession, "refresh").mockImplementation(async () => {
      await PgSession.refreshWith(user);
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it("takes the server's copy before offering its own", async () => {
    const effect = session();
    await settle();

    expect(calls.filter((c) => c !== "hold" && c !== "release")).toEqual([
      "pushChats",
      "pull",
      "push",
    ]);
    effect.dispose();
  });

  it("does not move the user off the page they loaded", async () => {
    sync.mockResolvedValue({ imported: [], replaced: [], latest: "Newest" });

    const effect = session();
    await settle();

    expect(switchWorkspace).not.toHaveBeenCalled();
    effect.dispose();
  });

  it("opens the newest project when the user actually signs in", async () => {
    sync.mockResolvedValue({ imported: [], replaced: [], latest: "Newest" });

    const effect = session();
    await settle();
    // A second transition: the cookie has already been restored, so this is
    // the user coming back through the sign-in flow
    await PgSession.refreshWith(null);
    await PgSession.refreshWith(user);
    await settle();

    expect(switchWorkspace).toHaveBeenCalledWith("Newest");
    effect.dispose();
  });

  it("reopens the current project when the server replaced its files", async () => {
    sync.mockResolvedValue({
      imported: [],
      replaced: ["Hello Anchor"],
      latest: "Hello Anchor",
    });

    const effect = session();
    await settle();

    // Not a navigation -- the editor is showing files that are no longer what
    // is on disk, and this is what makes it re-read them
    expect(switchWorkspace).toHaveBeenCalledWith("Hello Anchor");
    effect.dispose();
  });

  it("holds pushes from load until the account has been read", async () => {
    const effect = session();
    await settle();

    // Held before anything can fire, released the moment the reconcile is
    // done -- a push that gets out first carries no token and comes back
    // refused, which the user was shown as a conflict
    expect(calls.indexOf("hold")).toBe(0);
    expect(calls.indexOf("release")).toBeGreaterThan(calls.indexOf("pull"));
    expect(calls.indexOf("release")).toBeLessThan(calls.indexOf("push"));
    effect.dispose();
  });

  it("releases them even when the reconcile fails", async () => {
    sync.mockRejectedValue(new Error("offline"));

    const effect = session();
    await settle();

    // A reconcile that failed is a reason to let this device save its work,
    // not to hold it forever
    expect(calls).toContain("release");
    effect.dispose();
  });

  it("releases them when nobody is signed in", async () => {
    jest.spyOn(PgSession, "refresh").mockImplementation(async () => {
      await PgSession.refreshWith(null);
    });

    const effect = session();
    await settle();

    expect(calls).toContain("release");
    expect(calls).not.toContain("pull");
    effect.dispose();
  });
});
