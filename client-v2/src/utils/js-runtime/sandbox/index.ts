// The entry of `runtime.html`, the sandboxed frame project code runs in
// (`craco.config.js`). `global-fetch` comes first: web3.js keeps the
// `globalThis.fetch` it finds when it loads.
import "./global-fetch";

import { awaitPortFrom, channelFor } from "./channel";
import { bridgeRpcThrough } from "./fetch-bridge";
import { prepareWeb3, runWith } from "./runtime";

prepareWeb3();

awaitPortFrom(window.parent)(window).then((port) => {
  const channel = channelFor(port);
  bridgeRpcThrough(channel.rpc);
  channel.onRun(runWith(channel));
});
