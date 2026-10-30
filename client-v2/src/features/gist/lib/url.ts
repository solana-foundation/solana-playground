/** A gist, as a URL or a link names it */
export type GistRef = {
  /** Gist id */
  id: string;
  /** Owner's login, when the URL carries it */
  owner?: string;
  /** Revision (commit) of the gist, when the URL pins one */
  revision?: string;
};

/** Gist ids and revisions are hex; the oldest ids are decimal, which fits */
const HEX_REGEX = /^[0-9a-f]+$/i;

/** GitHub logins: letters, digits and single dashes */
const OWNER_REGEX = /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i;

/** Where gist pages live */
const PAGE_HOSTS = ["gist.github.com", "www.gist.github.com"];

/** Where a gist's raw files live */
const RAW_HOST = "gist.githubusercontent.com";

const isHex = (segment: string | undefined): segment is string =>
  !!segment && HEX_REGEX.test(segment);

/**
 * Read a gist page's path: `<owner>/<id>[/<revision>]` or `<id>`.
 *
 * @param segments the path's non-empty segments
 * @returns the gist, or `null` when the path names none
 */
const fromPageSegments = (segments: string[]): GistRef | null => {
  if (segments.length === 1) {
    return isHex(segments[0]) ? { id: segments[0] } : null;
  }

  const [owner, id, revision, ...rest] = segments;
  if (rest.length || !OWNER_REGEX.test(owner) || !isHex(id)) return null;
  if (revision === undefined) return { owner, id };
  return isHex(revision) ? { owner, id, revision } : null;
};

/**
 * Read a raw file's path: `<owner>/<id>/raw[/<revision>]/<file>`. The segment
 * after `raw` is a revision only when it is hex and a file name follows it;
 * otherwise it is the file's name.
 *
 * @param segments the path's non-empty segments
 * @returns the gist, or `null` when the path names none
 */
const fromRawSegments = (segments: string[]): GistRef | null => {
  const [owner, id, raw, maybeRevision, ...rest] = segments;
  if (!OWNER_REGEX.test(owner ?? "") || !isHex(id) || raw !== "raw") {
    return null;
  }

  return isHex(maybeRevision) && rest.length
    ? { owner, id, revision: maybeRevision }
    : { owner, id };
};

/**
 * Get the gist a URL names, in any form GitHub hands out: the gist's page,
 * `<owner>/<id>` or `<id>`, with an anchor to one of its files, or
 * `<owner>/<id>/<revision>`; or one of its raw files. A revision is read only
 * after an owner: GitHub never links `<id>/<revision>`, and two hex segments
 * read as owner and id.
 *
 * @param input URL, with or without `https://`
 * @returns the gist, or `null` when the input is not a gist URL
 */
export const parseGistUrl = (input: string): GistRef | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(
      /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
  } catch {
    // Not a URL at all, which is an answer: not a gist URL
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (PAGE_HOSTS.includes(url.hostname)) return fromPageSegments(segments);
  if (url.hostname === RAW_HOST) return fromRawSegments(segments);
  return null;
};

/**
 * Whether the input is a gist URL.
 *
 * @param input URL to check
 * @returns whether {@link parseGistUrl} reads a gist from it
 */
export const isGistUrl = (input: string) => parseGistUrl(input) !== null;

/**
 * Read a gist link's path after `/gist/`: `<id>` or `<id>/<revision>`.
 *
 * @param path path after `/gist/`
 * @returns the gist, or `null` when the path names none
 */
export const parseGistRef = (path: string): GistRef | null => {
  const [id, revision, ...rest] = path.split("/");
  if (rest.some(Boolean) || !isHex(id)) return null;
  if (!revision) return { id };
  return isHex(revision) ? { id, revision } : null;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/gist/lib/url", () => {
    it.each([
      [
        "https://gist.github.com/alice/0123abcd/9f8e7d",
        { owner: "alice", id: "0123abcd", revision: "9f8e7d" },
      ],
      ["gist.github.com/alice/0123abcd", { owner: "alice", id: "0123abcd" }],
      ["https://gist.github.com/0123abcd", { id: "0123abcd" }],
      ["https://www.gist.github.com/0123abcd", { id: "0123abcd" }],
      [
        "https://gist.github.com/alice/0123abcd#file-lib-rs",
        { owner: "alice", id: "0123abcd" },
      ],
      [
        "https://gist.github.com/alice/0123abcd/",
        { owner: "alice", id: "0123abcd" },
      ],
      [
        "https://gist.github.com/alice/0123abcd?x=1",
        { owner: "alice", id: "0123abcd" },
      ],
      [
        "https://gist.githubusercontent.com/alice/0123abcd/raw/9f8e7d/lib.rs",
        { owner: "alice", id: "0123abcd", revision: "9f8e7d" },
      ],
      [
        "https://gist.githubusercontent.com/alice/0123abcd/raw/lib.rs",
        { owner: "alice", id: "0123abcd" },
      ],
      [" https://gist.github.com/0123abcd ", { id: "0123abcd" }],
      ["http://gist.github.com/0123ABCD", { id: "0123ABCD" }],
      [
        "https://gist.githubusercontent.com/alice/0123abcd/raw/beef",
        { owner: "alice", id: "0123abcd" },
      ],
    ])("parseGistUrl(%s)", (input, expected) => {
      expect(parseGistUrl(input)).toEqual(expected);
      expect(isGistUrl(input)).toBe(true);
    });

    it.each([
      "https://github.com/alice/repo",
      "https://gist.github.com/",
      "https://gist.github.com/alice",
      "https://gist.github.com/alice/not-hex",
      "not a url",
      "",
      "https://evil.com/gist.github.com/alice/0123abcd",
      "https://gist.github.com.evil.com/alice/0123abcd",
      "ftp://gist.github.com/alice/0123abcd",
      "https://gist.github.com/alice/0123abcd/9f8e7d/extra",
      "https://gist.github.com/alice/0123abcd/revisions",
      "https://gist.github.com/-alice/0123abcd",
      "https://gist.githubusercontent.com/alice/0123abcd/lib.rs",
      "https://gist.githubusercontent.com/-x/0123abcd/raw/lib.rs",
    ])("parseGistUrl(%s) is null", (input) => {
      expect(parseGistUrl(input)).toBeNull();
      expect(isGistUrl(input)).toBe(false);
    });

    it("parseGistRef reads a link's id and revision", () => {
      expect(parseGistRef("0123abcd")).toEqual({ id: "0123abcd" });
      expect(parseGistRef("0123abcd/9f8e7d")).toEqual({
        id: "0123abcd",
        revision: "9f8e7d",
      });
      expect(parseGistRef("0123abcd/")).toEqual({ id: "0123abcd" });
    });

    it.each(["x y", "", "0123abcd/9f8e7d/more", "../0123", "0123abcd//9f8e7d"])(
      "parseGistRef(%s) is null",
      (path) => {
        expect(parseGistRef(path)).toBeNull();
      }
    );
  });
}
