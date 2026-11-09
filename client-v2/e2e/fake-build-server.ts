import type { Page } from "@playwright/test";

import { PLANNED_1_1_2 } from "../src/features/tutorial-conversation/model/build-logs.fixture";

/**
 * The build server for the tutorial specs, answered in the test. A build of
 * Hello Anchor's `lib.rs` fails with the Anchor 1.1.2 server's real log while the
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
        json: { stderr: PLANNED_1_1_2, uuid: null, idl: null },
      });
    }
    const code = hasNameArgument(lib) ? HELLO_NAME : HELLO_WORLD;
    // No IDL, as an Anchor 1.1.2 build brings none: the tutorial calls
    // through the one it ships (HOO-2688)
    return route.fulfill({
      // eslint-disable-next-line unicorn/no-null -- the server's JSON for a build with no IDL
      json: { stderr: PASSED, uuid: UUIDS[code], idl: null },
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
