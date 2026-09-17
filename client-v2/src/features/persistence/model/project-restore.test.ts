import { syncProjectsFromServer } from "./project-restore";
import { PgProjectSync } from "./project-sync";
import { PgExplorer } from "../../../utils/explorer/explorer";
import type { ServerProject } from "./project-sync";

const project = (
  id: string,
  name: string,
  updatedAt = "2026-01-01T00:00:00.000Z"
): ServerProject => ({ id, name, kind: "project", updatedAt });

/** Pretend the explorer holds these workspaces, name -> id */
const withLocal = (local: Record<string, string>) => {
  jest
    .spyOn(PgExplorer, "allWorkspaceNames", "get")
    .mockReturnValue(Object.keys(local));
  jest
    .spyOn(PgExplorer, "workspaceIdOf")
    .mockImplementation((name: string) => local[name]);
  jest
    .spyOn(PgExplorer, "workspaceNameOf")
    .mockImplementation((id: string) =>
      Object.keys(local).find((name) => local[name] === id)
    );
};

const stubCreation = () => {
  const created: { name: string; id?: string }[] = [];
  jest
    .spyOn(PgExplorer, "importWorkspace")
    .mockImplementation(async (name: string, opts: { id: string }) => {
      created.push({ name, id: opts.id });
    });
  return created;
};

const serverHas = (...projects: ServerProject[]) => {
  jest.spyOn(PgProjectSync, "list").mockResolvedValue(projects);
  jest.spyOn(PgProjectSync, "fetch").mockImplementation(async (id: string) => {
    const found = projects.find((p) => p.id === id);
    return found ? { ...found, snapshot: { files: {} } } : null;
  });
};

describe("syncProjectsFromServer", () => {
  afterEach(() => jest.restoreAllMocks());

  it("matches on id, not name, so a local project sharing a name is left alone", async () => {
    withLocal({ alpha: "local-uuid" });
    const created = stubCreation();
    jest
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockResolvedValue(undefined as never);
    serverHas(project("server-uuid", "alpha"));

    const result = await syncProjectsFromServer();

    expect(result.imported).toEqual(["alpha (imported)"]);
    expect(created[0].id).toBe("server-uuid");
  });

  it("takes the server's files for a project this browser already has", async () => {
    withLocal({ alpha: "shared-id" });
    const replace = jest
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(PgProjectSync, "list")
      .mockResolvedValue([project("shared-id", "alpha")]);
    jest.spyOn(PgProjectSync, "fetch").mockResolvedValue({
      ...project("shared-id", "alpha"),
      snapshot: { files: { "src/lib.rs": "fn main() {}" } },
    });

    const result = await syncProjectsFromServer();

    expect(result.replaced).toEqual(["alpha"]);
    expect(replace).toHaveBeenCalledWith("alpha", {
      "src/lib.rs": "fn main() {}",
    });
  });

  it("never switches workspace itself, so a sync cannot interrupt the user", async () => {
    withLocal({});
    stubCreation();
    const switchSpy = jest
      .spyOn(PgExplorer, "switchWorkspace")
      .mockResolvedValue(undefined as never);
    serverHas(project("server-uuid", "alpha"));

    await syncProjectsFromServer();

    expect(switchSpy).not.toHaveBeenCalled();
  });

  it("adopts the server's id, so the two devices converge", async () => {
    withLocal({});
    const created = stubCreation();
    serverHas(project("server-uuid", "alpha"));

    await syncProjectsFromServer();

    expect(created).toEqual([{ name: "alpha", id: "server-uuid" }]);
  });

  it("keeps going when one project cannot be fetched", async () => {
    withLocal({});
    const created = stubCreation();
    jest
      .spyOn(PgProjectSync, "list")
      .mockResolvedValue([project("a", "alpha"), project("b", "beta")]);
    jest
      .spyOn(PgProjectSync, "fetch")
      .mockImplementation(async (id: string) =>
        id === "b" ? { ...project("b", "beta"), snapshot: { files: {} } } : null
      );

    const result = await syncProjectsFromServer();

    expect(result.imported).toEqual(["beta"]);
    expect(created).toHaveLength(1);
  });

  it("reports the newest project, whatever order the server listed them in", async () => {
    withLocal({});
    stubCreation();
    serverHas(
      project("a", "older", "2026-01-01T00:00:00.000Z"),
      project("b", "newer", "2026-03-01T00:00:00.000Z")
    );

    expect((await syncProjectsFromServer()).latest).toBe("newer");
  });

  it("does nothing at all when the server holds no projects", async () => {
    withLocal({ alpha: "local-uuid" });
    const replace = jest
      .spyOn(PgExplorer, "replaceWorkspaceFiles")
      .mockResolvedValue(undefined as never);
    jest.spyOn(PgProjectSync, "list").mockResolvedValue([]);

    const result = await syncProjectsFromServer();

    expect(result).toEqual({ imported: [], replaced: [], latest: null });
    expect(replace).not.toHaveBeenCalled();
  });
});
