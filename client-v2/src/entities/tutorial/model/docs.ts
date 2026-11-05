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

/** Shows a doc page, by file; false when this workspace has no such page */
type DocListener = (file: string) => boolean;

const listeners = new Set<DocListener>();

/**
 * Asks the tutorial's workspace to open a doc page as a tab, by its file
 * name. The assistant's answer asks when a link to a doc is pressed; the
 * workspace listens while it shows a tutorial in its frame. A page never
 * opens unasked.
 *
 * @returns whether a workspace showed the page; false with none listening
 *   (the frame is not drawn below its widest layout), so the link opens as a
 *   link instead
 */
export const requestDoc = (file: string): boolean => {
  let isShown = false;
  listeners.forEach((listen) => {
    if (listen(file)) isShown = true;
  });
  return isShown;
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

    it("passes a request to every listener until it stops listening", () => {
      const listen = vi.fn(() => true);
      const stop = onDocRequest(listen);
      expect(requestDoc("idl.md")).toBe(true);
      stop();
      expect(requestDoc("programs.md")).toBe(false);
      expect(listen.mock.calls).toEqual([["idl.md"]]);
    });

    it("says a request was not shown when no listener has the page", () => {
      const stop = onDocRequest(() => false);
      expect(requestDoc("idl.md")).toBe(false);
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
