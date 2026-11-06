import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectOf, resolveRoute, upstreamPath } from "./route.mjs";

const UUID = "0b9f4d3e-6c1a-4f7e-9a2b-3c4d5e6f7a8b";

describe("resolveRoute", () => {
  it("admits a build", () => {
    assert.deepEqual(resolveRoute("POST", "/build"), {
      ok: true,
      kind: "build",
      unstable: false,
    });
  });

  it("admits a deploy, naming the program for the route to check", () => {
    assert.deepEqual(resolveRoute("GET", `/deploy/${UUID}`), {
      ok: true,
      kind: "deploy",
      unstable: false,
      programId: UUID,
    });
  });

  it("admits the unstable twins", () => {
    assert.deepEqual(resolveRoute("POST", "/unstable/build"), {
      ok: true,
      kind: "build",
      unstable: true,
    });
    assert.deepEqual(resolveRoute("GET", `/unstable/deploy/${UUID}`), {
      ok: true,
      kind: "deploy",
      unstable: true,
      programId: UUID,
    });
  });

  it("answers 405 with the allowed method for the wrong one", () => {
    assert.deepEqual(resolveRoute("GET", "/build"), {
      ok: false,
      status: 405,
      allow: "POST",
    });
    assert.deepEqual(resolveRoute("POST", `/deploy/${UUID}`), {
      ok: false,
      status: 405,
      allow: "GET",
    });
  });

  for (const path of [
    "/share/abc",
    "/new",
    "/unstable/bundle",
    "/deploy/..",
    `/deploy/${UUID}/x`,
    "/deploy/../share/abc",
    "/build/",
    "",
  ]) {
    it(`answers 404 for ${JSON.stringify(path)}`, () => {
      assert.deepEqual(resolveRoute("POST", path), { ok: false, status: 404 });
    });
  }
});

describe("upstreamPath", () => {
  it("reads the rewrite's path parameter", () => {
    assert.equal(upstreamPath("/api/build-server?path=build"), "/build");
    assert.equal(
      upstreamPath(`/api/build-server?path=unstable%2Fdeploy%2F${UUID}`),
      `/unstable/deploy/${UUID}`
    );
  });

  it("reads the path the dev server leaves below /api", () => {
    assert.equal(upstreamPath("/build-server/build"), "/build");
    assert.equal(
      upstreamPath(`/build-server/deploy/${UUID}?x=1`),
      `/deploy/${UUID}`
    );
    assert.equal(upstreamPath("/api/build-server/build"), "/build");
  });

  it("ignores a caller's own ?path= on a full path", () => {
    assert.equal(
      upstreamPath(`/api/build-server/build?path=deploy%2F${UUID}`),
      "/build"
    );
  });

  it("refuses more than one ?path=", () => {
    assert.equal(
      upstreamPath("/api/build-server?path=build&path=new"),
      undefined
    );
  });

  it("finds no path on the bare route", () => {
    assert.equal(upstreamPath("/api/build-server"), undefined);
    assert.equal(upstreamPath("/build-server"), undefined);
  });

  it("keeps an encoded dot-dot from turning into a real one", () => {
    const path = upstreamPath("/api/build-server?path=deploy%2F..%2Fshare%2Fx");
    assert.deepEqual(resolveRoute("GET", path ?? ""), {
      ok: false,
      status: 404,
    });
  });
});

describe("projectOf", () => {
  it("takes the id and name the client sent", () => {
    assert.deepEqual(projectOf({ project: { id: "p1", name: "hello" } }), {
      id: "p1",
      name: "hello",
    });
  });

  it("caps each at 200 characters", () => {
    const long = "x".repeat(500);
    const { id, name } = projectOf({ project: { id: long, name: long } });
    assert.equal(id?.length, 200);
    assert.equal(name?.length, 200);
  });

  it("drops what is not a string", () => {
    const none = { id: undefined, name: undefined };
    assert.deepEqual(projectOf({ project: { id: 1, name: false } }), none);
    assert.deepEqual(projectOf(undefined), none);
    assert.deepEqual(projectOf("text"), none);
  });
});
