import { PgChatStorage } from "./chat-storage";
import { PgChatSync } from "./chat-sync";
import { PgSyncClient } from "./sync-client";
import { PgSession } from "../../auth";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

const item = (n: number): ChatItem => ({
  kind: "user",
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  createdAt: new Date(n * 1000).toISOString(),
  text: `m${n}`,
});

/** Only `id` matters to sync; the rest of the session user is display */
const signedIn = () =>
  PgSession.refreshWith({ id: "u1", name: null, image: null, login: null });

/** `/api/sync` says yes; everything else is the caller's to describe */
const respondingWith = (rest: (url: string) => unknown) =>
  jest.fn().mockImplementation((url: string) =>
    url === "/api/sync"
      ? Promise.resolve({
          ok: true,
          json: async () => ({ enabled: true, db: "ok" }),
        })
      : rest(url)
  ) as unknown as typeof fetch;

describe("PgChatSync", () => {
  beforeEach(async () => {
    await PgChatStorage.clear();
    PgSession.reset();
    PgSyncClient.reset();
  });

  it("does nothing when signed out", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    await PgChatStorage.write("t1", [item(1)]);

    await PgChatSync.push("t1");

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("posts the local thread when signed in", async () => {
    global.fetch = respondingWith(() =>
      Promise.resolve({ ok: true, json: async () => ({ written: 1 }) })
    );
    await signedIn();
    await PgChatStorage.write("t1", [item(1)]);

    await PgChatSync.push("t1");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/conversations",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("keeps the local thread when the push fails, so nothing is lost", async () => {
    global.fetch = respondingWith(() => Promise.reject(new Error("offline")));
    await signedIn();
    await PgChatStorage.write("t1", [item(1)]);

    const ok = await PgChatSync.pushAll();

    expect(ok).toBe(false);
    expect(await PgChatStorage.read("t1")).toHaveLength(1);
  });

  it("merges the server thread with local items on pull, without duplicates", async () => {
    global.fetch = respondingWith(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ items: [item(1), item(2)] }),
      })
    );
    await signedIn();
    await PgChatStorage.write("t1", [item(2), item(3)]);

    const merged = await PgChatSync.pull("t1");

    expect(merged!.map((i) => (i as { text: string }).text)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("leaves the local thread alone when the server cannot be reached", async () => {
    global.fetch = respondingWith(() => Promise.reject(new Error("offline")));
    await signedIn();
    await PgChatStorage.write("t1", [item(1)]);

    expect(await PgChatSync.pull("t1")).toBeNull();
    expect(await PgChatStorage.read("t1")).toHaveLength(1);
  });

  it("stays local when the deployment has no database", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve({
            ok: true,
            json: async () => ({ enabled: false, db: "unconfigured" }),
          })
        : Promise.reject(new Error("should not be called"))
    ) as unknown as typeof fetch;
    await signedIn();
    await PgChatStorage.write("t1", [item(1)]);

    expect(await PgChatSync.push("t1")).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
