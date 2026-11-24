// The entry of `wallet-keys.html`, the key page the app frames from the key
// origin (`craco.config.js`). It imports only `@noble/ed25519` and the
// key-origin modules, plus `shared/config/client-env.ts` for the build's
// public settings (`scripts/wallet-keys-entry.test.mjs`): no app module runs
// on the origin that holds the keys.
import { walletOriginEnv } from "../../../../shared/config/client-env";
import { appOriginFor } from "../origin";
import { awaitPortFor, serveWith } from "./channel";
import { handlerWith, reportFailure } from "./handler";
import { panelRouteOf, runPanelWith } from "./panel";
import { indexedDbKeyStore, KEY_DB_NAME, requestPersistence } from "./store";

const appOrigin = appOriginFor(walletOriginEnv().APP_ORIGIN)(window.location);

// No fragment is the hidden frame; a panel fragment, the visible panel
const isHidden = window.location.hash === "";
const route = isHidden ? undefined : panelRouteOf(window.location.hash);

// Unframed, built without an app to serve, or on an unknown fragment, the
// page does nothing: it never announces itself
if (appOrigin && window.parent !== window && (isHidden || route)) {
  const store = indexedDbKeyStore(KEY_DB_NAME);
  // The key origin holds the only copy of the keys, so the browser must not
  // evict it under storage pressure
  void requestPersistence(navigator.storage).catch(reportFailure);
  const handle = handlerWith(store);
  const connected = awaitPortFor(appOrigin)(window.parent)(window);
  if (route) runPanelWith(handle)(store)(route, connected);
  else void connected.then(serveWith(handle));
}
