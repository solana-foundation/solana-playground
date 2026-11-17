import { createLogger } from "@/shared/lib/logger";

import type { Doc } from "./definition/types";

const log = createLogger("tutorial:docs");

/** An address without what does not name a different page */
const pageOf = (href: string): string | undefined => {
  try {
    const url = new URL(href);
    const host = url.host.replace(/^www\./, "");
    return `${host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    // Not an absolute address, so no doc's page: the link opens as a link
    log.debug("a link that is no address names no doc", { context: { href } });
    return undefined;
  }
};

/**
 * The tutorial's doc that a link points at: its page on its own site, with
 * or without `www.`, a trailing slash, a query or a section. None for any
 * other link. Only addresses match, never a doc's file name: the assistant
 * is given the addresses, and a link that is not shown as a tab opens as a
 * link, which a bare `idl.md` cannot
 */
export const docForLink = (
  docs: readonly Doc[] | undefined,
  href: string
): Doc | undefined => {
  const page = pageOf(href);
  if (page === undefined) return undefined;
  return docs?.find((doc) => pageOf(doc.url) === page);
};

/**
 * The section a link names: its fragment, decoded, as a heading's id reads.
 * None for a link with no fragment, or one that is no address
 */
export const sectionOf = (href: string): string | undefined => {
  let hash: string;
  try {
    hash = new URL(href).hash;
  } catch {
    log.debug("a link that is no address names no section", {
      context: { href },
    });
    return undefined;
  }
  if (hash.length < 2) return undefined;
  const raw = hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    // A fragment that is not percent-encoded as written is read as it is
    log.debug("a section that does not decode is read as written", {
      context: { href },
    });
    return raw;
  }
};

/** What a link to a doc asks for: the page, and the heading it named, if one */
export interface DocRequest {
  /** The Markdown file's name in `docs/`: `idl.md` */
  file: string;
  /** A heading's id on the page, from the link's fragment */
  section?: string;
}

/**
 * The request a link makes of the tutorial's docs: the page `docForLink`
 * finds and the section the same link names; none for a link to no doc.
 * One place reads both from the link, so they cannot come apart
 */
export const docRequestFor =
  (docs: readonly Doc[] | undefined) =>
  (href: string): DocRequest | undefined => {
    const doc = docForLink(docs, href);
    if (!doc) return undefined;
    return { file: doc.file, section: sectionOf(href) };
  };

/** Shows a doc page; false when this workspace has no such page */
type DocListener = (request: DocRequest) => boolean;

const listeners = new Set<DocListener>();

/**
 * Asks the tutorial's workspace to open a doc page as a tab, by its file
 * name, at the section the link named when it named one. The assistant's
 * answer asks when a link to a doc is pressed; the workspace listens while
 * it shows a tutorial in its frame. A page never opens unasked.
 *
 * @returns whether a workspace showed the page; false with none listening
 *   (the frame is not drawn below its widest layout), so the link opens as a
 *   link instead
 */
export const requestDoc = (request: DocRequest): boolean => {
  let isShown = false;
  listeners.forEach((listen) => {
    if (listen(request)) isShown = true;
  });
  if (isShown) shownListeners.forEach((listen) => listen(request.file));
  return isShown;
};

const shownListeners = new Set<(file: string) => void>();

/**
 * Listens for a doc page a `requestDoc` actually showed, never for one no
 * workspace had (the phone moves to Code only then); returns what stops
 * listening
 */
export const onDocShown = (listen: (file: string) => void) => {
  shownListeners.add(listen);
  return () => {
    shownListeners.delete(listen);
  };
};

/** Listens for `requestDoc`; returns what stops listening */
export const onDocRequest = (listen: DocListener) => {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
};

const codeListeners = new Set<() => void>();

/**
 * Asks the workspace to bring the code back in front of a doc page: the
 * lesson shows a line in a file that may already be open, which the
 * explorer announces to no one
 */
export const requestCode = () => {
  codeListeners.forEach((listen) => listen());
};

/** Listens for `requestCode`; returns what stops listening */
export const onCodeRequest = (listen: () => void) => {
  codeListeners.add(listen);
  return () => {
    codeListeners.delete(listen);
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("entities/tutorial/model/docs", () => {
    const IDL: Doc = {
      title: "IDL",
      url: "https://www.anchor-lang.com/docs/basics/idl",
      file: "idl.md",
    };
    const PROGRAMS: Doc = {
      title: "Programs",
      url: "https://solana.com/docs/core/programs",
      file: "programs.md",
    };
    const DOCS = [IDL, PROGRAMS];

    it("finds a doc by its page, however the link writes the address", () => {
      expect(docForLink(DOCS, IDL.url)).toBe(IDL);
      expect(
        docForLink(
          DOCS,
          "https://anchor-lang.com/docs/basics/idl/#discriminators"
        )
      ).toBe(IDL);
      expect(
        docForLink(DOCS, "https://www.solana.com/docs/core/programs?x=1")
      ).toBe(PROGRAMS);
    });

    it("finds no doc by its file name, which would open as a broken link", () => {
      expect(docForLink(DOCS, "programs.md")).toBeUndefined();
    });

    it("finds nothing for another page, a relative link or no docs", () => {
      expect(
        docForLink(DOCS, "https://www.anchor-lang.com/docs/basics")
      ).toBeUndefined();
      expect(docForLink(DOCS, "/tutorials")).toBeUndefined();
      expect(docForLink(undefined, IDL.url)).toBeUndefined();
    });

    it("builds a request from a link: the doc's file and the link's section", () => {
      expect(docRequestFor(DOCS)(`${IDL.url}#discriminators`)).toEqual({
        file: "idl.md",
        section: "discriminators",
      });
      expect(docRequestFor(DOCS)(PROGRAMS.url)).toEqual({
        file: "programs.md",
        section: undefined,
      });
      expect(docRequestFor(DOCS)("https://example.com/#x")).toBeUndefined();
    });

    it("reads a link's section from its fragment, decoded", () => {
      expect(sectionOf(`${IDL.url}#discriminators`)).toBe("discriminators");
      expect(sectionOf(`${IDL.url}#declare_id-macro`)).toBe("declare_id-macro");
      expect(sectionOf(`${IDL.url}#a%20b`)).toBe("a b");
      expect(sectionOf(`${IDL.url}#a%zz`)).toBe("a%zz");
      expect(sectionOf(IDL.url)).toBeUndefined();
      expect(sectionOf(`${IDL.url}#`)).toBeUndefined();
      expect(sectionOf("idl.md#discriminators")).toBeUndefined();
    });

    it("passes a request to every listener until it stops listening", () => {
      const listen = vi.fn(() => true);
      const stop = onDocRequest(listen);
      expect(requestDoc({ file: "idl.md", section: "discriminators" })).toBe(
        true
      );
      stop();
      expect(requestDoc({ file: "programs.md" })).toBe(false);
      expect(listen.mock.calls).toEqual([
        [{ file: "idl.md", section: "discriminators" }],
      ]);
    });

    it("says a request was not shown when no listener has the page", () => {
      const stop = onDocRequest(() => false);
      expect(requestDoc({ file: "idl.md" })).toBe(false);
      stop();
    });

    it("passes a request for the code to every listener", () => {
      const listen = vi.fn();
      const stop = onCodeRequest(listen);
      requestCode();
      stop();
      requestCode();
      expect(listen).toHaveBeenCalledOnce();
    });
  });
}
