import { PgExplorer } from "../explorer";
import { writeWorkspaceFile } from "../explorer/workspace-file";
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
