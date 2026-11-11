import {
  initLogger,
  memoryProvider,
  resetLogger,
} from "../../shared/lib/logger";
import { PgExplorer } from "../explorer";
import { writeWorkspaceFile } from "../explorer/workspace-file";
import { PgRouter } from "../router";
import { PgTutorial } from "./tutorial";

vi.mock("../explorer/workspace-file", () => ({
  writeWorkspaceFile: vi.fn(async () => {}),
}));

describe("PgTutorial.getStorage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves through writeWorkspaceFile, which keeps a new file across a reload", async () => {
    vi.spyOn(PgExplorer.fs, "readToJSONOrDefault").mockImplementation(
      async (_path, defaultValue) => defaultValue
    );

    await PgTutorial.getStorage<{ lesson: string }>({ lesson: "" }).setItem(
      "lesson",
      "x"
    );

    expect(writeWorkspaceFile).toHaveBeenCalledWith(
      ".workspace/tutorial-storage.json",
      JSON.stringify({ lesson: "x" })
    );
  });

  // The lesson store tells the learner a save failed only if it hears of it
  it("passes a failed write on to the caller", async () => {
    vi.spyOn(PgExplorer.fs, "readToJSONOrDefault").mockImplementation(
      async (_path, defaultValue) => defaultValue
    );
    vi.mocked(writeWorkspaceFile).mockRejectedValueOnce(new Error("gone"));

    await expect(
      PgTutorial.getStorage<{ lesson: string }>({ lesson: "" }).setItem(
        "lesson",
        "x"
      )
    ).rejects.toThrow("gone");
  });
});

describe("PgTutorial.open", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLogger();
  });

  /** A started tutorial whose saved page fails to read with `error` */
  const openWith = async (error: Error) => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    vi.spyOn(PgTutorial, "isStarted").mockReturnValue(true);
    vi.spyOn(PgTutorial, "getMetadata").mockRejectedValue(error);
    const navigate = vi
      .spyOn(PgRouter, "navigate")
      .mockResolvedValue(undefined as never);
    await PgTutorial.open("Counter PDA Tutorial");
    return { logged, navigate };
  };

  it("opens page 1 when the saved page cannot be read, and reports why", async () => {
    const { logged, navigate } = await openWith(new SyntaxError("bad json"));
    expect(navigate).toHaveBeenCalledWith("/tutorials/counter-pda-tutorial/1");
    expect(logged.entries).toHaveLength(1);
    expect(logged.entries[0].ns).toBe("tutorial:open");
    expect(logged.entries[0].error?.message).toBe("bad json");
    expect(logged.entries[0].report).toBe(true);
  });

  it("only warns when there is no saved page yet", async () => {
    const { logged, navigate } = await openWith(
      new Error("ENOENT: no such file")
    );
    expect(navigate).toHaveBeenCalledWith("/tutorials/counter-pda-tutorial/1");
    expect(logged.entries).toHaveLength(1);
    expect(logged.entries[0].report).toBeFalsy();
  });
});

describe("PgTutorial.isStarted", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A repository, gist or docs link's view holds no list in memory; a lesson
  // listed beside it opens from the project list all the same
  it("reads the stored names beside a link", () => {
    vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue(undefined);
    vi.spyOn(PgExplorer, "storedWorkspaceNames", "get").mockReturnValue([
      "Counter PDA Tutorial",
    ]);

    expect(PgTutorial.isStarted("Counter PDA Tutorial")).toBe(true);
    expect(PgTutorial.isStarted("Other")).toBe(false);
  });

  it("throws while no names are read", () => {
    vi.spyOn(PgExplorer, "storedWorkspaceNames", "get").mockReturnValue(
      undefined
    );

    expect(() => PgTutorial.isStarted("Counter PDA Tutorial")).toThrow(
      "Explorer not initialized"
    );
  });
});
