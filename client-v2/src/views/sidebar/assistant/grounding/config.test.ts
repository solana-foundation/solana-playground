import { parseServers } from "./config";

describe("parseServers", () => {
  it("loads an entry that still names the server executor as a browser server", () => {
    const servers = parseServers(
      JSON.stringify([
        { id: "remote", url: "https://mcp.test/mcp", executor: "server" },
      ])
    );

    expect(servers).toEqual([
      {
        id: "remote",
        name: "remote",
        url: "https://mcp.test/mcp",
        enabled: true,
      },
    ]);
  });
});
