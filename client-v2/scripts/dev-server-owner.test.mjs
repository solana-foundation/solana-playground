import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  DEV_SERVER_ROOT_HEADER,
  DevServerRefusal,
  decideDevServer,
  foreignServerMessage,
  portHolderPid,
  silentServerMessage,
  whoseServer,
  whoseServerSync,
} from "./dev-server-owner.mjs";

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "owner-")));
const OTHER_ROOT = "/somewhere/else/client-v2";

/** A server on a free port; `handler` decides the answer. Closed with the test. */
const serve = async (t, handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return server.address().port;
};

const sendRoot = (value) => (req, res) => {
  // The dev server sends the root percent-encoded, so any path is a legal
  // header value.
  res.writeHead(
    200,
    value === null
      ? {}
      : { [DEV_SERVER_ROOT_HEADER]: encodeURIComponent(value) }
  );
  res.end();
};

const freePort = async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
};

/** Port -> pid of the process `serveInChild` started on it. */
const childPids = new Map();

/** The same kind of server in another process, so the parent's event loop
 * may block on `whoseServerSync` without starving it. */
const serveInChild = async (t, value) => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const s = require("node:http").createServer((q, r) => {
         r.writeHead(200, { ${JSON.stringify(
           DEV_SERVER_ROOT_HEADER
         )}: ${JSON.stringify(encodeURIComponent(value))} });
         r.end();
       });
       s.listen(0, () => process.stdout.write(String(s.address().port)));`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] }
  );
  t.after(() => child.kill());
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    // A child that dies before printing its port must fail the test, not hang it.
    child.once("exit", (code) =>
      reject(new Error(`server child exited (${code}) before printing a port`))
    );
    child.stdout.once("data", (data) => {
      const port = Number(data.toString());
      childPids.set(port, child.pid);
      resolve(port);
    });
  });
};

test("a port nobody listens on is free", async () => {
  const port = await freePort();
  assert.deepEqual(await whoseServer({ port, root: ROOT }), { kind: "free" });
});

test("a server naming this root is ours", async (t) => {
  const port = await serve(t, sendRoot(ROOT));
  assert.deepEqual(await whoseServer({ port, root: ROOT }), { kind: "ours" });
});

test("a server naming this root through a symlink is ours", async (t) => {
  const link = path.join(os.tmpdir(), `owner-link-${process.pid}`);
  fs.symlinkSync(ROOT, link);
  t.after(() => fs.rmSync(link));
  const port = await serve(t, sendRoot(link));
  assert.deepEqual(await whoseServer({ port, root: ROOT }), { kind: "ours" });
});

test("a server naming another root is foreign, with that root", async (t) => {
  const port = await serve(t, sendRoot(OTHER_ROOT));
  assert.deepEqual(await whoseServer({ port, root: ROOT }), {
    kind: "foreign",
    root: OTHER_ROOT,
  });
});

test("a server without the header is foreign, root unknown", async (t) => {
  const port = await serve(t, sendRoot(null));
  assert.deepEqual(await whoseServer({ port, root: ROOT }), {
    kind: "foreign",
    root: null,
  });
});

test("a server that never answers is silent, not foreign", async (t) => {
  const port = await serve(t, () => {});
  assert.deepEqual(await whoseServer({ port, root: ROOT, timeoutMs: 200 }), {
    kind: "silent",
    timeoutMs: 200,
  });
});

test("whoseServerSync gives the same answers from a child process", async (t) => {
  const ours = await serveInChild(t, ROOT);
  const other = await serveInChild(t, OTHER_ROOT);
  assert.deepEqual(whoseServerSync({ port: ours, root: ROOT }), {
    kind: "ours",
  });
  assert.deepEqual(whoseServerSync({ port: other, root: ROOT }), {
    kind: "foreign",
    root: OTHER_ROOT,
  });
});

test("decideDevServer starts on a free port", async () => {
  const port = await freePort();
  assert.equal(decideDevServer({ port, root: ROOT }), "start");
});

test("decideDevServer reuses our own server", async (t) => {
  const port = await serveInChild(t, ROOT);
  assert.equal(decideDevServer({ port, root: ROOT }), "reuse");
});

test("decideDevServer refuses a foreign server, naming port, root and remedy", async (t) => {
  const port = await serveInChild(t, OTHER_ROOT);
  assert.throws(
    () => decideDevServer({ port, root: ROOT }),
    (error) =>
      error.message.includes(String(port)) &&
      error.message.includes(OTHER_ROOT) &&
      error.message.includes("PORT=")
  );
});

test("decideDevServer names the pid holding a foreign server's port", async (t) => {
  const port = await serveInChild(t, OTHER_ROOT);
  assert.throws(
    () => decideDevServer({ port, root: ROOT }),
    (error) => error.message.includes(`pid ${childPids.get(port)}`)
  );
});

test("decideDevServer names the pid holding a silent server's port", async (t) => {
  // In this process: the probe blocks our event loop, so it never answers.
  const port = await serve(t, () => {});
  assert.throws(
    () => decideDevServer({ port, root: ROOT, timeoutMs: 300 }),
    (error) => error.message.includes(`pid ${process.pid}`)
  );
});

test("on a queue port, the refusal calls the holder a leftover to stop", async (t) => {
  const port = await serveInChild(t, OTHER_ROOT);
  assert.throws(
    () => decideDevServer({ port, root: ROOT, fromQueue: true }),
    (error) =>
      error.message.includes("left over from an earlier run") &&
      error.message.includes(`kill ${childPids.get(port)}`) &&
      !error.message.includes("PORT=")
  );
});

test("portHolderPid is null for a free port", async () => {
  assert.equal(portHolderPid(await freePort()), null);
});

test("foreignServerMessage with an unknown root says it is no dev server of this worktree", () => {
  const message = foreignServerMessage({ port: 3000, root: null });
  assert.match(message, /3000/);
  assert.match(message, /not a client-v2 dev server of this worktree/);
  assert.match(message, /PORT=/);
});

test("silentServerMessage says the server did not answer in time and how to go on", () => {
  const message = silentServerMessage({ port: 3000, timeoutMs: 15000 });
  assert.match(message, /3000/);
  assert.match(message, /did not answer within 15 s/);
  assert.match(message, /busy compiling/);
  assert.match(message, /PORT=/);
});

test("decideDevServer refuses a silent server with a DevServerRefusal", async (t) => {
  const port = await serve(t, () => {});
  assert.throws(
    () => decideDevServer({ port, root: ROOT, timeoutMs: 300 }),
    (error) =>
      error instanceof DevServerRefusal &&
      error.message.includes("did not answer") &&
      error.message.includes(String(port))
  );
});

test("a foreign server is refused with a DevServerRefusal too", async (t) => {
  const port = await serveInChild(t, OTHER_ROOT);
  assert.throws(
    () => decideDevServer({ port, root: ROOT }),
    (error) => error instanceof DevServerRefusal
  );
});

test("a root with non-ASCII characters reads as ours when sent encoded", async (t) => {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "проект-"))
  );
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const port = await serve(t, sendRoot(dir));
  assert.deepEqual(await whoseServer({ port, root: dir }), { kind: "ours" });
});

test("a header that does not decode is compared as written", async (t) => {
  const port = await serve(t, (req, res) => {
    res.writeHead(200, { [DEV_SERVER_ROOT_HEADER]: "%E0%A4%A" });
    res.end();
  });
  assert.deepEqual(await whoseServer({ port, root: ROOT }), {
    kind: "foreign",
    root: "%E0%A4%A",
  });
});

test("a header path that cannot be resolved here is foreign with that path", async (t) => {
  const missing = path.join(ROOT, "no", "such", "dir");
  const port = await serve(t, sendRoot(missing));
  assert.deepEqual(await whoseServer({ port, root: ROOT }), {
    kind: "foreign",
    root: missing,
  });
});

test("a header path below a file falls back to the text too", async (t) => {
  const file = path.join(ROOT, "a-file");
  fs.writeFileSync(file, "");
  const below = path.join(file, "child");
  const port = await serve(t, sendRoot(below));
  assert.deepEqual(await whoseServer({ port, root: ROOT }), {
    kind: "foreign",
    root: below,
  });
});

test("a server that drops the connection is foreign, with the cause", async (t) => {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const owner = await whoseServer({ port, root: ROOT });
  assert.equal(owner.kind, "foreign");
  assert.equal(owner.root, null);
  assert.ok(owner.detail);
  assert.ok(
    foreignServerMessage({
      port,
      root: owner.root,
      detail: owner.detail,
    }).includes(owner.detail)
  );
});

test("foreignServerMessage for an unknown root names the header and the dropped connection", () => {
  const message = foreignServerMessage({ port: 3000, root: null });
  assert.match(message, /X-Dev-Server-Root/);
  assert.match(message, /dropped the connection/);
});

test("a probe child that exits non-zero is a refusal naming port, root and stderr", () => {
  const script = path.join(ROOT, "fails.mjs");
  fs.writeFileSync(script, 'console.error("boom"); process.exit(1);');
  assert.throws(
    () => whoseServerSync({ port: 4321, root: ROOT, script }),
    (error) =>
      error instanceof DevServerRefusal &&
      error.message.includes("4321") &&
      error.message.includes(ROOT) &&
      error.message.includes("boom")
  );
});

test("a probe child that prints no JSON is a refusal", () => {
  const script = path.join(ROOT, "garbage.mjs");
  fs.writeFileSync(script, 'console.log("not json");');
  assert.throws(
    () => whoseServerSync({ port: 4321, root: ROOT, script }),
    (error) => error instanceof DevServerRefusal && /4321/.test(error.message)
  );
});

test("a probe child that outlives its time is refused as silent", () => {
  const script = path.join(ROOT, "hangs.mjs");
  fs.writeFileSync(script, "setInterval(() => {}, 1000);");
  assert.throws(
    () =>
      whoseServerSync({
        port: 4321,
        root: ROOT,
        script,
        timeoutMs: 100,
        graceMs: 200,
      }),
    (error) =>
      error instanceof DevServerRefusal &&
      error.message.includes("did not answer")
  );
});

test("a probe child killed by a signal is a failure refusal naming the signal", () => {
  const script = path.join(ROOT, "killed.mjs");
  fs.writeFileSync(script, 'process.kill(process.pid, "SIGKILL");');
  assert.throws(
    () => whoseServerSync({ port: 4321, root: ROOT, script }),
    (error) =>
      error instanceof DevServerRefusal &&
      error.message.includes("signal SIGKILL") &&
      error.message.includes("4321") &&
      !error.message.includes("did not answer")
  );
});
