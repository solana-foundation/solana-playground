import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PgSession } from "@/features/auth";
import { PgFs } from "@/utils/explorer/fs";

import { TOOL_CONFIG_PATH } from "./model/tool-config";
import { PgAssistant } from "./store";

const files = () =>
  (PgFs as unknown as { __files: Map<string, string> }).__files;

const stored = () => JSON.parse(files().get(TOOL_CONFIG_PATH) ?? "{}");

const skill = (id: string, enabled: boolean) => ({
  id,
  name: id,
  description: `About ${id}.`,
  enabled,
  source: { type: "remote", baseUrl: `https://s.test/${id}/`, entry: "S.md" },
});

/** The routes answer with these lists; a list left out fails */
const serve = (lists: { skills?: unknown[]; servers?: unknown[] }) => {
  const fetched: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    fetched.push(url);
    if (url.includes("/api/skills") && lists.skills) {
      return new Response(JSON.stringify({ skills: lists.skills }));
    }
    if (url.includes("/api/mcp") && lists.servers) {
      return new Response(JSON.stringify({ servers: lists.servers }));
    }
    return new Response("{}", { status: 500 });
  });
  return fetched;
};

/** What a new page starts from: nothing in memory, the file as it is */
const reloadPage = () => {
  const fresh: Record<string, unknown> = {
    _skillChoices: new Map(),
    _gatewayServersOff: new Set(),
    _localServers: [],
    _missingCredentials: new Map(),
    _skills: [],
    _gatewayServers: [],
    _mcpTools: {},
    _skillsListedFor: undefined,
    _gatewayServersListedFor: undefined,
    _toolConfigRead: undefined,
    _canWriteToolConfig: true,
  };
  Object.entries(fresh).forEach(([key, value]) =>
    Reflect.set(PgAssistant, key, value)
  );
};

const signIn = (id: string) =>
  // eslint-disable-next-line unicorn/no-null -- the session's wire shape
  PgSession.refreshWith({ id, name: id, image: null, login: null });

const DOCS = {
  id: "docs",
  name: "Docs",
  url: "https://docs.test/mcp",
  enabled: false,
};

describe("PgAssistant tool config", () => {
  beforeEach(() => {
    files().clear();
    reloadPage();
  });

  afterEach(async () => {
    await PgAssistant.whenPersisted();
    // eslint-disable-next-line unicorn/no-null -- the session's wire shape
    await PgSession.refreshWith(null);
    vi.restoreAllMocks();
  });

  it("keeps a skill turned off and a server added across a reload", async () => {
    serve({ skills: [skill("a", true)], servers: [] });
    await PgAssistant.initMcp();

    PgAssistant.setSkillEnabled("a", false);
    PgAssistant.setMcpServers([DOCS]);
    await PgAssistant.whenPersisted();
    reloadPage();
    await PgAssistant.initMcp();

    expect(PgAssistant.enabledSkillIds).toEqual([]);
    expect(PgAssistant.localMcpServers.map((s) => s.id)).toEqual(["docs"]);
  });

  it("keeps a gateway server off, and asks it nothing after the reload", async () => {
    const gateway = {
      id: "g",
      name: "G",
      url: "https://g.test/mcp",
      enabled: true,
    };
    serve({ skills: [], servers: [gateway] });
    await PgAssistant.loadMcpServers();

    PgAssistant.setMcpServerEnabled("g", false);
    await PgAssistant.whenPersisted();
    reloadPage();
    const fetched = serve({ skills: [], servers: [gateway] });
    await PgAssistant.initMcp();

    expect(PgAssistant.enabledMcpServers).toEqual([]);
    expect(fetched.filter((url) => url.includes("g.test"))).toEqual([]);
  });

  it("follows the default for a skill the file does not name", async () => {
    serve({ skills: [skill("a", true)], servers: [] });
    await PgAssistant.initMcp();
    PgAssistant.setSkillEnabled("a", false);
    await PgAssistant.whenPersisted();

    reloadPage();
    serve({ skills: [skill("a", true), skill("new", true)], servers: [] });
    await PgAssistant.initMcp();

    expect(PgAssistant.enabledSkillIds).toEqual(["new"]);
  });

  it("drops an unknown id on a signed-in write, once that account's list answered", async () => {
    files().set(TOOL_CONFIG_PATH, JSON.stringify({ skills: { gone: false } }));
    serve({ skills: [skill("a", true)], servers: [] });
    await signIn("u1");
    await PgAssistant.initMcp();

    PgAssistant.setSkillEnabled("a", false);
    await PgAssistant.whenPersisted();

    expect(stored().skills).toEqual({ a: false });
  });

  it("keeps a signed-in skill's choice through a signed-out write", async () => {
    files().set(TOOL_CONFIG_PATH, JSON.stringify({ skills: { pro: false } }));
    serve({ skills: [skill("a", true)], servers: [] });
    await PgAssistant.initMcp();

    PgAssistant.setSkillEnabled("a", false);
    await PgAssistant.whenPersisted();

    expect(stored().skills).toEqual({ pro: false, a: false });
  });

  it("keeps every choice when the skills route is down", async () => {
    files().set(TOOL_CONFIG_PATH, JSON.stringify({ skills: { a: false } }));
    serve({ servers: [] });
    await signIn("u1");
    await PgAssistant.initMcp();

    PgAssistant.setMcpServers([DOCS]);
    await PgAssistant.whenPersisted();

    expect(stored().skills).toEqual({ a: false });
  });

  it("does not let an edit before the read replace what is stored", async () => {
    files().set(TOOL_CONFIG_PATH, JSON.stringify({ skills: { a: false } }));

    PgAssistant.setMcpServers([DOCS]);
    await PgAssistant.whenPersisted();

    expect(stored().skills).toEqual({ a: false });
    expect(stored().mcpServers[0].id).toBe("docs");
  });

  it("stores no credential, and names what to enter again after the reload", async () => {
    PgAssistant.setMcpServers([
      {
        id: DOCS.id,
        name: DOCS.name,
        url: "https://docs.test/mcp?key=url-secret",
        enabled: DOCS.enabled,
        authToken: "token-secret",
        headers: { "x-key": "header-secret" },
      },
    ]);
    await PgAssistant.whenPersisted();

    expect(files().get(TOOL_CONFIG_PATH)).not.toMatch(/secret/);
    // Still usable this session
    expect(PgAssistant.localMcpServers[0].authToken).toBe("token-secret");
    expect(PgAssistant.missingMcpCredentials.size).toBe(0);

    reloadPage();
    serve({ skills: [], servers: [] });
    await PgAssistant.initMcp();

    expect(PgAssistant.localMcpServers[0].authToken).toBeUndefined();
    expect(PgAssistant.missingMcpCredentials.get("docs")).toEqual([
      "authToken",
      "headers",
      "url query",
    ]);
  });

  it("reads a file that does not parse as no edits and leaves it until an edit", async () => {
    files().set(TOOL_CONFIG_PATH, "{ not json");
    serve({ skills: [skill("a", true)], servers: [] });

    await PgAssistant.initMcp();

    expect(PgAssistant.enabledSkillIds).toEqual(["a"]);
    expect(files().get(TOOL_CONFIG_PATH)).toBe("{ not json");
  });

  it("keeps the stored servers when one is added before the read lands", async () => {
    files().set(
      TOOL_CONFIG_PATH,
      JSON.stringify({
        mcpServers: [
          { id: "old", url: "https://old.test/mcp", missing: ["authToken"] },
        ],
      })
    );

    PgAssistant.setMcpServers([DOCS]);
    await PgAssistant.whenPersisted();

    expect(PgAssistant.localMcpServers.map((s) => s.id)).toEqual([
      "old",
      "docs",
    ]);
    expect(stored().mcpServers.map((s: { id: string }) => s.id)).toEqual([
      "old",
      "docs",
    ]);
    expect(PgAssistant.missingMcpCredentials.get("old")).toEqual(["authToken"]);
  });

  it("does not write over a file storage could not read, and reads again on the next edit", async () => {
    const stuck = JSON.stringify({ skills: { a: false } });
    files().set(TOOL_CONFIG_PATH, stuck);
    vi.spyOn(PgFs, "readToString").mockRejectedValueOnce(new Error("EIO"));

    PgAssistant.setMcpServers([DOCS]);
    await PgAssistant.whenPersisted();

    expect(files().get(TOOL_CONFIG_PATH)).toBe(stuck);
    expect(PgAssistant.localMcpServers.map((s) => s.id)).toEqual(["docs"]);

    PgAssistant.setMcpServerEnabled("docs", true);
    await PgAssistant.whenPersisted();

    expect(stored().skills).toEqual({ a: false });
    expect(stored().mcpServers[0].enabled).toBe(true);
  });

  it("settles when a write fails, and keeps the edit in memory", async () => {
    vi.spyOn(PgFs, "writeFile").mockRejectedValueOnce(new Error("quota"));

    PgAssistant.setMcpServers([DOCS]);

    await expect(PgAssistant.whenPersisted()).resolves.toBeUndefined();
    expect(PgAssistant.localMcpServers.map((s) => s.id)).toEqual(["docs"]);
  });

  it("stops asking for a credential once its entry is applied changed, and only that entry", async () => {
    const restored = (id: string) => ({
      id,
      url: `https://${id}.test/mcp`,
      missing: ["authToken"],
    });
    files().set(
      TOOL_CONFIG_PATH,
      JSON.stringify({ mcpServers: [restored("a"), restored("b")] })
    );
    serve({ skills: [], servers: [] });
    await PgAssistant.initMcp();
    const [a, b] = PgAssistant.localMcpServers;

    PgAssistant.setMcpServers([
      a,
      {
        id: b.id,
        name: "Renamed",
        url: b.url,
        enabled: b.enabled,
      },
    ]);
    await PgAssistant.whenPersisted();
    reloadPage();
    await PgAssistant.initMcp();

    expect(Array.from(PgAssistant.missingMcpCredentials.keys())).toEqual(["a"]);
  });
});
