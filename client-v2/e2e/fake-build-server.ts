import type { Page } from "@playwright/test";

import { PLANNED } from "../src/features/tutorial-conversation/model/build-logs.fixture";

/**
 * The build server for the tutorial specs, answered in the test. A build of
 * Hello Anchor's `lib.rs` fails with the server's real E0412 log while the
 * file has no `struct Hello`, as the step plans, and passes otherwise with an
 * Anchor IDL read off `lib.rs`: `hello`, with a `name: string` argument once
 * its signature takes one. A deploy downloads a few KB of program bytes whose
 * first byte says which `hello` was built, so the fake devnet answers a call
 * with the log of the code it actually holds.
 */
export interface FakeBuildServer {
  /** The `lib.rs` of every build, in order */
  readonly builds: string[];
  /** Requests the fake could not answer as the tutorial expects */
  readonly unhandled: string[];
}

/** The first program byte of a `hello()` build */
export const HELLO_WORLD = 1;
/** The first program byte of a `hello(name: String)` build */
export const HELLO_NAME = 2;

/** One build id per program, so a step 4 deploy cannot reuse step 2's bytes */
const UUIDS = {
  [HELLO_WORLD]: "e2e00000-0000-4000-8000-000000000001",
  [HELLO_NAME]: "e2e00000-0000-4000-8000-000000000002",
} as const;

/** Small, so a deploy writes three buffer chunks; the app checks no ELF */
const programBytes = (code: number) => {
  const bytes = Buffer.alloc(2600, 7);
  bytes[0] = code;
  return bytes;
};

const PASSED =
  "   Compiling solpg v0.1.0 (/home/solpg/programs)\n    Finished release [optimized] target(s) in 3.92s\n";

/** Whether `lib`'s `hello` takes a `name: String` */
const hasNameArgument = (lib: string) =>
  /fn\s+hello\s*(<[^>]*>)?\s*\([^)]*\bname\s*:\s*String\b/.test(lib);

/** Anchor 0.29's IDL of the `hello` that `lib` declares */
const idlOf = (lib: string) => ({
  version: "0.1.0",
  name: "hello_anchor",
  instructions: [
    {
      name: "hello",
      accounts: [],
      args: hasNameArgument(lib) ? [{ name: "name", type: "string" }] : [],
    },
  ],
});

export const fakeBuildServer = async (page: Page): Promise<FakeBuildServer> => {
  const builds: string[] = [];
  const unhandled: string[] = [];
  await page.route("**/build", async (route) => {
    let files: [string, string][] | undefined;
    try {
      files = (
        route.request().postDataJSON() as { files?: [string, string][] } | null
      )?.files;
    } catch (error) {
      // Not JSON: recorded below with the cause, then refused
      unhandled.push(`build body is not JSON: ${String(error)}`);
      files = undefined;
    }
    if (!Array.isArray(files)) {
      unhandled.push("build with no `files` in its body");
      return route.fulfill({ status: 400, body: "no files" });
    }
    const lib = files.find(([path]) => path.endsWith("src/lib.rs"))?.[1];
    if (lib === undefined) {
      // Not the planned failure: the app sent no lib.rs at all
      unhandled.push(
        `build without src/lib.rs: ${files.map(([p]) => p).join(", ")}`
      );
      return route.fulfill({ status: 400, body: "no src/lib.rs" });
    }
    builds.push(lib);
    // Comments aside, so a mention of the struct in one does not compile it
    if (!/struct Hello\b/.test(lib.replace(/\/\/.*$/gm, ""))) {
      return route.fulfill({
        // eslint-disable-next-line unicorn/no-null -- the server's JSON for a failed build
        json: { stderr: PLANNED, uuid: null, idl: null },
      });
    }
    const code = hasNameArgument(lib) ? HELLO_NAME : HELLO_WORLD;
    return route.fulfill({
      json: { stderr: PASSED, uuid: UUIDS[code], idl: idlOf(lib) },
    });
  });
  await page.route("**/deploy/*", (route) => {
    const uuid = route.request().url().split("/").pop();
    const code = Object.entries(UUIDS).find(([, id]) => id === uuid)?.[0];
    if (!code) {
      unhandled.push(`deploy of an unknown build ${uuid}`);
      return route.fulfill({ status: 404, body: "" });
    }
    return route.fulfill({
      contentType: "application/octet-stream",
      body: programBytes(Number(code)),
    });
  });
  return { builds, unhandled };
};
