import type { McpServerEntry } from "@/features/mcp";
import { parseServers } from "@/features/mcp";
import { report } from "@/features/persistence";
import { writeConfigFile } from "@/utils/explorer/config-file";
import { PgFs } from "@/utils/explorer/fs";

/**
 * The user's edits to the assistant's tools, as a delta over what the
 * deployment lists: what survives a reload.
 *
 * Beside the chats in the code's volume rather than in `localStorage`, which
 * is near its origin budget; outside `/.config/chats`, so sign-out's clear of
 * that directory leaves it. Nothing here identifies an account.
 */
export const TOOL_CONFIG_PATH = "/.config/assistant-tools.json";

/** What a server entry can hold a credential in. None of it reaches the file. */
export type CredentialField =
  | "authToken"
  | "headers"
  | "queryParams"
  | "protection"
  | "url query";

const CREDENTIAL_FIELDS: readonly CredentialField[] = [
  "authToken",
  "headers",
  "queryParams",
  "protection",
  "url query",
];

/** A path on the page's own origin, which stays relative when stored */
const PATH_RELATIVE = /^\/(?![/\\])/;

/**
 * The server's address without its login, query or fragment, read by the URL
 * parser `serverUrl` uses. Patterns missed what the parser accepts: a
 * scheme-relative or space-led login, backslashes for slashes, a newline in
 * the query. A URL holding none of them is kept as typed.
 */
const bareUrl = (url: string) => {
  const parsed = new URL(url.trim(), window.location.origin);
  if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
    return url;
  }
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  if (!PATH_RELATIVE.test(url.trim())) return parsed.href;
  // A dot segment can leave `//host/...` as the path, which reads back as another host; `/.` keeps it on this one
  return parsed.pathname.startsWith("//")
    ? `/.${parsed.pathname}`
    : parsed.pathname;
};

const isFilled = (map: Record<string, string> | undefined) =>
  !!map && Object.keys(map).length > 0;

const HOLDS_CREDENTIAL: Record<
  CredentialField,
  (server: McpServerEntry) => boolean
> = {
  authToken: (server) => !!server.authToken,
  headers: (server) => isFilled(server.headers),
  queryParams: (server) => isFilled(server.queryParams),
  protection: (server) => !!server.protection,
  "url query": (server) => bareUrl(server.url) !== server.url,
};

/** The fields of an entry that hold a credential right now */
export const credentialsIn = (server: McpServerEntry): CredentialField[] =>
  CREDENTIAL_FIELDS.filter((field) => HOLDS_CREDENTIAL[field](server));

/** What is in memory, and what the deployment listed for it to be a delta over */
export interface ToolConfigState {
  skillChoices: ReadonlyMap<string, boolean>;
  skills: readonly { id: string; enabled: boolean }[];
  /** Whether `skills` is this account's whole list, so an id missing from it is unknown */
  skillsListed: boolean;
  gatewayServersOff: ReadonlySet<string>;
  gatewayServerIds: readonly string[];
  /** Whether `gatewayServerIds` is this account's whole list */
  gatewayServersListed: boolean;
  servers: readonly McpServerEntry[];
  /** Per server, the fields a restored entry lost and has not been applied with a change since */
  missing: ReadonlyMap<string, readonly CredentialField[]>;
}

/** What the file gives back */
export interface ToolConfig {
  skillChoices: ReadonlyMap<string, boolean>;
  gatewayServersOff: ReadonlySet<string>;
  servers: readonly McpServerEntry[];
  missing: ReadonlyMap<string, readonly CredentialField[]>;
}

/** The delta, serialised with every credential left out */
export const encodeToolConfig = (state: ToolConfigState): string => {
  const skills = new Map(state.skills.map((skill) => [skill.id, skill]));
  const choices = [...state.skillChoices].filter(([id, enabled]) => {
    const skill = skills.get(id);
    return skill ? enabled !== skill.enabled : !state.skillsListed;
  });
  const gatewayIds = new Set(state.gatewayServerIds);
  const off = [...state.gatewayServersOff].filter(
    (id) => !state.gatewayServersListed || gatewayIds.has(id)
  );

  return JSON.stringify(
    {
      skills: Object.fromEntries(choices),
      gatewayServersOff: off,
      mcpServers: state.servers.map((server) => {
        const missing = CREDENTIAL_FIELDS.filter(
          (field) =>
            credentialsIn(server).includes(field) ||
            state.missing.get(server.id)?.includes(field)
        );
        return {
          id: server.id,
          name: server.name,
          url: bareUrl(server.url),
          enabled: server.enabled,
          ...(missing.length ? { missing } : {}),
        };
      }),
    },
    // eslint-disable-next-line unicorn/no-null -- JSON.stringify's signature: no replacer
    null,
    2
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Read the file's text. A field or entry that makes no sense is dropped and
 * the rest kept.
 *
 * @throws when the text is not a JSON object
 */
export const decodeToolConfig = (text: string): ToolConfig => {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("Not an object");

  const servers: McpServerEntry[] = [];
  const missing = new Map<string, readonly CredentialField[]>();
  for (const raw of Array.isArray(parsed.mcpServers) ? parsed.mcpServers : []) {
    let server: McpServerEntry;
    try {
      [server] = parseServers(JSON.stringify([raw]));
    } catch (e) {
      // One bad entry must not cost the rest; the next write leaves it out
      report("drop stored MCP server", e);
      continue;
    }
    if (servers.some((entry) => entry.id === server.id)) continue;
    servers.push(server);
    const fields = isRecord(raw) && raw.missing;
    const known = CREDENTIAL_FIELDS.filter(
      (field) => Array.isArray(fields) && fields.includes(field)
    );
    if (known.length) missing.set(server.id, known);
  }

  return {
    skillChoices: new Map(
      Object.entries(isRecord(parsed.skills) ? parsed.skills : {}).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
      )
    ),
    gatewayServersOff: new Set(
      (Array.isArray(parsed.gatewayServersOff)
        ? parsed.gatewayServersOff
        : []
      ).filter((id): id is string => typeof id === "string")
    ),
    servers,
    missing,
  };
};

const isMissing = (error: unknown) => {
  const e = error as { code?: string; message?: string };
  return e?.code === "ENOENT" || !!e?.message?.includes("ENOENT");
};

/**
 * What a read found. `unreadable` is storage failing, not the file: what it
 * holds may be fine, so it must not be written over. A file that does not parse
 * has nothing left to save and counts as `none`, reported.
 */
export type ToolConfigRead =
  | { kind: "found"; config: ToolConfig }
  | { kind: "none" }
  | { kind: "unreadable" };

export const readToolConfig = async (): Promise<ToolConfigRead> => {
  let text: string;
  try {
    text = await PgFs.readToString(TOOL_CONFIG_PATH);
  } catch (e) {
    if (isMissing(e)) return { kind: "none" };
    report("read tool config", e);
    return { kind: "unreadable" };
  }
  try {
    return { kind: "found", config: decodeToolConfig(text) };
  } catch (e) {
    report("parse tool config", e);
    return { kind: "none" };
  }
};

/** Store the edits. A failure is reported: a lost write must not take the panel down. */
export const writeToolConfig = async (text: string) => {
  try {
    await writeConfigFile(TOOL_CONFIG_PATH, text);
  } catch (e) {
    report("write tool config", e);
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const state = (over: Partial<ToolConfigState>): ToolConfigState => ({
    skillChoices: over.skillChoices ?? new Map(),
    skills: over.skills ?? [],
    skillsListed: over.skillsListed ?? true,
    gatewayServersOff: over.gatewayServersOff ?? new Set(),
    gatewayServerIds: over.gatewayServerIds ?? [],
    gatewayServersListed: over.gatewayServersListed ?? true,
    servers: over.servers ?? [],
    missing: over.missing ?? new Map(),
  });
  const server = (over: Partial<McpServerEntry>): McpServerEntry => ({
    id: "mine",
    name: "Mine",
    url: over.url ?? "https://mcp.test/mcp",
    enabled: over.enabled ?? true,
    authToken: over.authToken,
    headers: over.headers,
    queryParams: over.queryParams,
    protection: over.protection,
  });
  const stored = (over: Partial<ToolConfigState>) =>
    JSON.parse(encodeToolConfig(state(over)));

  describe("views/sidebar/assistant/model/tool-config", () => {
    it("keeps only the choices that differ from the default", () => {
      expect(
        stored({
          skills: [
            { id: "on", enabled: true },
            { id: "off", enabled: false },
          ],
          skillChoices: new Map([
            ["on", true],
            ["off", true],
          ]),
        }).skills
      ).toEqual({ off: true });
    });

    it("drops an unknown id once the list is known, and keeps it before", () => {
      const skillChoices = new Map([["gone", false]]);
      const gatewayServersOff = new Set(["gone"]);
      const known = stored({ skillChoices, gatewayServersOff });
      expect(known.skills).toEqual({});
      expect(known.gatewayServersOff).toEqual([]);

      const unknown = stored({
        skillChoices,
        gatewayServersOff,
        skillsListed: false,
        gatewayServersListed: false,
      });
      expect(unknown.skills).toEqual({ gone: false });
      expect(unknown.gatewayServersOff).toEqual(["gone"]);
    });

    it("stores no credential and names the fields that held one", () => {
      const text = encodeToolConfig(
        state({
          servers: [
            server({
              url: "https://user:login-secret@mcp.test/mcp?key=query-secret#f",
              authToken: "token-secret",
              headers: { "x-key": "header-secret" },
              queryParams: { key: "param-secret" },
              protection: { provider: "vercel", secret: "bypass-secret" },
            }),
          ],
        })
      );

      expect(text).not.toMatch(/secret/);
      expect(JSON.parse(text).mcpServers).toEqual([
        {
          id: "mine",
          name: "Mine",
          url: "https://mcp.test/mcp",
          enabled: true,
          missing: [
            "authToken",
            "headers",
            "queryParams",
            "protection",
            "url query",
          ],
        },
      ]);
    });

    it.each([
      ["a scheme-relative login", "//user:login-secret@mcp.test/mcp"],
      ["a login after a space", " https://user:login-secret@mcp.test/mcp"],
      [
        "a login behind backslashes",
        "https:\\\\user:login-secret@mcp.test/mcp",
      ],
      ["a query with a newline", "https://mcp.test/mcp?a=1\nkey=query-secret"],
      ["a relative path's query", "/api/mcp?key=query-secret"],
    ])("stores no credential from %s", (_, url) => {
      const text = encodeToolConfig(state({ servers: [server({ url })] }));

      expect(text).not.toMatch(/secret/);
      expect(JSON.parse(text).mcpServers[0].missing).toEqual(["url query"]);
    });

    it("keeps a stripped path on the page's own host", () => {
      const url = "/api/..//mcp.test/mcp?key=query-secret";
      const kept = stored({ servers: [server({ url })] }).mcpServers[0].url;

      expect(kept).not.toMatch(/secret/);
      expect(new URL(kept, window.location.origin).host).toBe(
        window.location.host
      );
      expect(
        decodeToolConfig(
          encodeToolConfig(state({ servers: [server({ url })] }))
        ).servers.map((entry) => entry.url)
      ).toEqual([kept]);
    });

    it("keeps a URL without a credential as it was typed", () => {
      expect(
        stored({ servers: [server({ url: "/api/mcp" })] }).mcpServers[0]
      ).toEqual({ id: "mine", name: "Mine", url: "/api/mcp", enabled: true });
    });

    it("keeps naming a field the entry was not given again", () => {
      expect(
        stored({
          servers: [server({})],
          missing: new Map([["mine", ["authToken"]]]),
        }).mcpServers[0].missing
      ).toEqual(["authToken"]);
    });

    it("gives back what it stored", () => {
      const config = decodeToolConfig(
        encodeToolConfig(
          state({
            skills: [{ id: "a", enabled: true }],
            skillChoices: new Map([["a", false]]),
            gatewayServerIds: ["g"],
            gatewayServersOff: new Set(["g"]),
            servers: [server({ enabled: false, authToken: "t" })],
          })
        )
      );

      expect(config.skillChoices).toEqual(new Map([["a", false]]));
      expect(config.gatewayServersOff).toEqual(new Set(["g"]));
      expect(config.servers).toEqual([
        {
          id: "mine",
          name: "Mine",
          url: "https://mcp.test/mcp",
          enabled: false,
        },
      ]);
      expect(config.missing).toEqual(new Map([["mine", ["authToken"]]]));
    });

    it("drops only what makes no sense", () => {
      const config = decodeToolConfig(
        JSON.stringify({
          skills: { a: false, b: "no" },
          gatewayServersOff: ["g", 1],
          mcpServers: [
            { id: "bad id", url: "https://mcp.test" },
            { id: "ok", url: "https://mcp.test", missing: ["authToken", "x"] },
            { id: "ok", url: "https://other.test" },
          ],
        })
      );

      expect(Array.from(config.skillChoices.keys())).toEqual(["a"]);
      expect(Array.from(config.gatewayServersOff)).toEqual(["g"]);
      expect(config.servers.map((s) => s.url)).toEqual(["https://mcp.test"]);
      expect(config.missing.get("ok")).toEqual(["authToken"]);
    });

    it.each(["{ not json", "[]", "1"])("throws on %s", (text) => {
      expect(() => decodeToolConfig(text)).toThrow();
    });
  });
}
