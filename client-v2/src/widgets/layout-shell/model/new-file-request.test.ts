import { beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({
  showFiles: vi.fn(),
  selectActiveFile: vi.fn(),
  failures: [] as unknown[],
}));
vi.mock("@/utils/view", () => ({ PgView: { showFiles: app.showFiles } }));
vi.mock("./active-file", () => ({ selectActiveFile: app.selectActiveFile }));
vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: () => (e: unknown) => app.failures.push(e),
}));

import { onNewFileRequest, requestNewFile } from "./new-file-request";

const subs: { dispose: () => void }[] = [];
const listen = (create: () => Promise<void>) => {
  const sub = onNewFileRequest(create);
  subs.push(sub);
  return sub;
};

beforeEach(() => {
  subs.splice(0).forEach((sub) => sub.dispose());
  vi.clearAllMocks();
  app.failures = [];
});

describe("widgets/layout-shell/model/new-file-request", () => {
  it("asks for the tree and waits for it", () => {
    requestNewFile();
    expect(app.showFiles).toHaveBeenCalledTimes(1);

    const create = vi.fn(async () => {});
    listen(create);
    expect(app.selectActiveFile).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("starts at once in a tree already drawn, and only for a request", () => {
    const create = vi.fn(async () => {});
    listen(create);
    expect(create).not.toHaveBeenCalled();
    requestNewFile();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("runs a request once, however many trees listen", () => {
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    listen(a);
    listen(b);
    requestNewFile();
    expect(a.mock.calls.length + b.mock.calls.length).toBe(1);
  });

  it("stops once disposed", () => {
    const create = vi.fn(async () => {});
    listen(create).dispose();
    requestNewFile();
    expect(create).not.toHaveBeenCalled();
    // Left for the next tree
    const next = vi.fn(async () => {});
    listen(next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("reports a failed start", async () => {
    const error = new Error("no tree");
    listen(() => Promise.reject(error));
    requestNewFile();
    await Promise.resolve();
    expect(app.failures).toEqual([error]);
  });
});
