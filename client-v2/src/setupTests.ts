// jsdom ships no Web Crypto. Browsers all do, so the app uses it directly and
// the gap is the test environment's, not the code's - polyfill rather than add
// a weaker fallback to production.
import { webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

// Same story: standard in browsers, absent from jsdom
if (!globalThis.TextEncoder) {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

// jsdom has no IndexedDB, and `PgFs` constructs a lightning-fs store the
// moment it is imported -- so any module that transitively reaches it fails to
// load here, not just the ones that use it. Since chat threads now live in
// `PgFs`, that is most of the assistant.
//
// `fake-indexeddb` does not help: lightning-fs throws bare `DOMException`s
// against it and takes the worker down. So the module is replaced with an
// in-memory one for every test, globally. Nothing under jsdom could use the
// real filesystem anyway; the browser round trip is covered in `e2e/`.
jest.mock("./utils/explorer/fs", () =>
  require("./test-utils/mock-fs").mockFsModule()
);
