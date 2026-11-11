// The "Build server" setting as the env configures it. A file of its own: it
// re-imports the module per case, since the env is read when the module loads.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { memoryProvider } from "@/shared/lib/logger";

vi.mock("../../utils", () => ({ PgCommon: { isUrl: () => true } }));
vi.mock("../../constants", () => ({ GITHUB_URL: "" }));
vi.mock("../create", () => ({ createSetting: (setting: unknown) => setting }));

let logged: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const load = async (url: string) => {
  vi.stubEnv("REACT_APP_SERVER_URL", url);
  // The fresh module registry has a fresh logger; the module under test logs there
  const logger = await import("@/shared/lib/logger");
  logged = logger.memoryProvider();
  logger.initLogger({ providers: [logged] });
  const { server } = await import("./server");
  const [setting] = server as unknown as {
    default: string;
    values: { name: string; value: string }[];
  }[];
  return setting;
};

describe("settings/server/server", () => {
  // Scenario "A fresh checkout" (client-v2-build-server-endpoint)
  it("defaults to a local server and warns once, naming the variable, when it is empty", async () => {
    const setting = await load("");

    expect(setting.default).toBe("http://localhost:8080");
    expect(logged.entries.map((e) => [e.ns, e.level])).toEqual([
      ["settings:server", "warn"],
    ]);
    expect(logged.entries[0].message).toContain("REACT_APP_SERVER_URL");
  });

  it("uses the variable and warns nothing when it is set", async () => {
    const setting = await load("https://server.example");

    expect(setting.default).toBe("https://server.example");
    expect(setting.values[0]).toEqual({
      name: "Solana Foundation",
      value: "https://server.example",
    });
    expect(logged.entries).toEqual([]);
  });
});
