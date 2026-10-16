import { PgCommon } from "./common";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const respond = (over: { ok?: boolean; status?: number; body?: string }) => {
  mockFetch.mockResolvedValue({
    ok: over.ok ?? true,
    status: over.status ?? 200,
    text: async () => over.body ?? "",
  });
};

beforeEach(() => mockFetch.mockReset());

describe("fetchText", () => {
  it("returns the body of an ok response", async () => {
    respond({ body: "pub fn main() {}" });
    await expect(PgCommon.fetchText("/crates/core.rs")).resolves.toBe(
      "pub fn main() {}"
    );
  });

  // A dev server answers an unknown path with the SPA shell, and HTML parses
  // as a valid file -- which is how a missing crate asset panicked the Rust
  // Analyzer WASM instead of failing here
  it("throws rather than returning a 404's body", async () => {
    respond({ ok: false, status: 404, body: "<!doctype html><html>" });

    await expect(PgCommon.fetchText("/crates/core.rs")).rejects.toThrow(
      "Request failed (404): /crates/core.rs"
    );
  });

  it("names the status it got", async () => {
    respond({ ok: false, status: 500, body: "" });
    await expect(PgCommon.fetchText("/a.md")).rejects.toThrow(
      "Request failed (500): /a.md"
    );
  });
});
