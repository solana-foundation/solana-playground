// The entry of `runtime.html`, the sandboxed frame project code runs in
// (`craco.config.js`). `global-fetch` comes first: web3.js keeps the
// `globalThis.fetch` it finds when it loads.
import "./global-fetch";

import { awaitPortFrom, channelFor, type SandboxChannel } from "./channel";
import { bridgeRpcThrough } from "./fetch-bridge";
import { prepareWeb3, runWith } from "./runtime";

// Project code may run only in an opaque origin: on the app's own origin it
// could read the page's storage. The server's CSP and the frame's `sandbox`
// attribute each make it opaque; without either, the runtime stops here and
// never announces itself, so no page can hand it code.
if (window.origin !== "null") {
  throw new Error(
    `The project-code runtime refuses to start on origin ${window.origin}: it runs only sandboxed.`
  );
}

// web3.js is patched before the page's port arrives. The patch prints only
// while project code runs, which is after the port has come
let channel: SandboxChannel | undefined;
prepareWeb3((text) => channel?.post({ type: "output", level: "warn", text }));

awaitPortFrom(window.parent)(window).then((port) => {
  channel = channelFor(port);
  bridgeRpcThrough(channel.rpc);
  channel.onRun(runWith(channel));
});
