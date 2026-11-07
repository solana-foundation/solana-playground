import { PgExplorer } from "../../../utils/explorer";
import { CacheItem, CandyCache } from "./cache";

// `utils` and the Sugar processor reach the wasm packages and the settings,
// which only exist once the app has booted; the cache needs three modules
vi.mock("../../../utils", async () => ({
  PgCommon: (await import("../../../utils/common")).PgCommon,
  PgExplorer: (await import("../../../utils/explorer")).PgExplorer,
  PgWeb3: (await import("../../../utils/web3")).PgWeb3,
}));
vi.mock("../processor", () => ({
  PgSugar: {
    PATHS: {
      CANDY_MACHINE_CACHE_FILEPATH: "metaplex/candy-machine/cache.json",
    },
  },
}));

const CACHE_PATH = "metaplex/candy-machine/cache.json";

/**
 * `sugar upload` and `sugar deploy` save the cache after work the user has
 * paid for (Bundlr uploads, transactions), and the links it holds live only in
 * memory until then. The explorer's limits must not refuse that save: a
 * collection of about 350 items is already over the 128 KB file limit.
 */

const storedFiles = () =>
  (PgExplorer.fs as unknown as { __files: Map<string, string> }).__files;

const reset = async () => {
  storedFiles().clear();
  const statics = PgExplorer as unknown as {
    _workspace: unknown;
    _initializedWorkspaceName: unknown;
  };
  // eslint-disable-next-line unicorn/no-null -- the explorer's own "no workspace yet"
  statics._workspace = null;
  // eslint-disable-next-line unicorn/no-null -- as above
  statics._initializedWorkspaceName = null;
  await PgExplorer.init();
};

/** A cache of `count` uploaded items, as `sugar upload` leaves it */
const uploadedCache = (count: number) => {
  const cache = new CandyCache();
  for (let i = 0; i < count; i++) {
    cache.items[i] = new CacheItem({
      name: `Item #${i}`,
      image_hash: "a".repeat(64),
      image_link: `https://arweave.net/${"i".repeat(43)}?ext=png`,
      metadata_hash: "b".repeat(64),
      metadata_link: `https://arweave.net/${"m".repeat(43)}`,
      onChain: false,
    });
  }
  return cache;
};

describe("CandyCache", () => {
  beforeEach(reset);

  it("saves a 500-item cache over the file size limit", async () => {
    await PgExplorer.createWorkspace("candy", {
      files: [["/candy/src/lib.rs", ""]],
    });
    const cache = uploadedCache(500);
    // `prettyJSON`, as the cache writes itself
    const expected = JSON.stringify(cache, undefined, 2);
    expect(expected.length).toBeGreaterThan(128 * 1024);

    // Twice, as the periodic save does: the second overwrites the first
    await cache.syncFile();
    await cache.syncFile();

    const path = `/candy/${CACHE_PATH}`;
    expect(storedFiles().get(path)).toBe(expected);
    expect(PgExplorer.files[path].content).toBe(expected);
  });
});
