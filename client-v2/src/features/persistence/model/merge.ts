import { diffArrays } from "diff";

import { report } from "./diagnostics";
import { isUserFile } from "./snapshot";
import type { FileHashes } from "./snapshot";

/** Where `PgProgramInfo` keeps the program's keypair, relative to a workspace */
export const PROGRAM_INFO_PATH = ".workspace/program-info.json";

/** A 64-byte secret key as `PgProgramInfo` stores it: an array of bytes */
const isSecretKey = (kp: unknown): kp is number[] =>
  Array.isArray(kp) &&
  kp.length === 64 &&
  kp.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);

/** A parsed `program-info.json`, or `null` for anything that is not one */
const parseProgramInfo = (
  content: string,
  side: "local" | "account"
): Record<string, unknown> | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    report(`program info: unreadable ${side} copy`, e);
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    report(`program info: malformed ${side} copy`, null);
    return null;
  }
  return parsed as Record<string, unknown>;
};

/**
 * The account's `program-info.json`, carrying this device's keypair when the
 * account has none.
 *
 * Sync replaces the local copy of the generated files with the account's, and
 * for this one file that can throw away the only keypair there is: a device
 * that built before generated files were uploaded holds a keypair the account
 * never received. Dropping it makes the next build mint a new program
 * address. Carried into the account's copy instead, the result differs from
 * the server's, so the device's next push hands the account the keypair.
 *
 * Only the keypair is carried; every other field is the account's. When both
 * sides hold one, the account's wins even if they differ, because that keeps
 * the program at the address the account already deploys to. Anything that is
 * not the stored shape leaves the account's copy as it is.
 *
 * @param local this device's copy, if it has one
 * @param account the account's copy, if it has one
 * @returns what the local file should hold, or `undefined` for no file
 */
export const keepLocalKeypair = (
  local: string | undefined,
  account: string | undefined
): string | undefined => {
  if (local === undefined) return account;
  const mine = parseProgramInfo(local, "local");
  if (!mine || !isSecretKey(mine.kp)) return account;

  if (account === undefined) return JSON.stringify({ kp: mine.kp });
  const theirs = parseProgramInfo(account, "account");
  // Present in any form means the account has a keypair of its own, or a file
  // nothing here can safely rewrite: either way it is left alone
  if (!theirs || (theirs.kp !== null && theirs.kp !== undefined)) {
    return account;
  }

  return JSON.stringify({ ...theirs, kp: mine.kp });
};

/**
 * `files`, the account's copy of a project, with this device's keypair
 * carried into it where the account has none -- see `keepLocalKeypair`.
 *
 * @returns `files` itself when nothing was carried
 */
export const withLocalKeypair = (
  files: Record<string, string>,
  local: Record<string, string>
): Record<string, string> => {
  const kept = keepLocalKeypair(
    local[PROGRAM_INFO_PATH],
    files[PROGRAM_INFO_PATH]
  );
  if (kept === files[PROGRAM_INFO_PATH]) return files;
  return { ...files, [PROGRAM_INFO_PATH]: kept! };
};

/**
 * The content a file had at the last agreement, for the files this device has
 * changed since. Keyed with its hash so a merge can check it belongs to the
 * agreement the mark describes, rather than trusting whichever copy was kept.
 */
export type BaseContents = Record<string, { hash: string; content: string }>;

/** `base[start, end)` is replaced by `lines` on one side */
interface Hunk {
  start: number;
  end: number;
  lines: string[];
  side: "ours" | "theirs";
}

const hunksOf = (
  base: string[],
  other: string[],
  side: Hunk["side"]
): Hunk[] => {
  const hunks: Hunk[] = [];
  let at = 0;
  let open: Hunk | null = null;

  for (const part of diffArrays(base, other)) {
    if (!part.added && !part.removed) {
      if (open) hunks.push(open);
      open = null;
      at += part.value.length;
      continue;
    }
    open ??= { start: at, end: at, lines: [], side };
    if (part.removed) {
      at += part.value.length;
      open.end = at;
    } else {
      open.lines.push(...(part.value as string[]));
    }
  }
  if (open) hunks.push(open);
  return hunks;
};

/**
 * Lines of a settled chunk that a side changed: `lines[start, start + count)`.
 * A `count` of 0 is lines that side deleted, gone from before `start`.
 */
export interface SettledChange {
  start: number;
  count: number;
  by: "ours" | "theirs" | "both";
}

/**
 * A run of lines in a file both sides edited.
 *
 * - `settled`: the same in every copy once the merge is done -- unchanged, or
 *   changed by one side only, or changed the same way by both. `changes`
 *   says which lines a side changed, for the resolve view to mark; absent
 *   when none did. Nothing that writes a file reads it.
 * - `conflict`: lines both sides changed differently, as the base had them
 *   and as each side has them now.
 *
 * Lines are the file split on `\n` alone, so joining a pane's lines with `\n`
 * gives back its text byte for byte, `\r` and a missing final newline
 * included.
 */
export type Chunk =
  | { kind: "settled"; lines: string[]; changes?: SettledChange[] }
  | { kind: "conflict"; base: string[]; ours: string[]; theirs: string[] };

/**
 * What `merge3` made of a file.
 *
 * A conflict carries the whole file, in order, rather than the positions of
 * its hunks: each pane of the resolve view is a join of the chunks (settled
 * lines plus that side's lines of each conflict), so the view never has to
 * diff again or agree with this module on how a hunk renders.
 */
export type Merge3 =
  | { kind: "clean"; text: string }
  | { kind: "conflict"; chunks: Chunk[] };

/**
 * Merge two edits of one file against the version both started from.
 *
 * Line-based diff3. Split on `\n` alone, so a `\r` stays part of its line and
 * a file without a trailing newline stays without one: everything outside the
 * changed lines comes back byte for byte.
 *
 * Changes that overlap *or touch* are a conflict, the way git treats them. Two
 * edits on adjacent lines of a program are not safely independent -- a
 * condition and the line it guards, say -- and a wrong merge is worse than a
 * question.
 *
 * @returns the merged text when nothing overlaps; otherwise the file as
 * chunks, with every change only one side made already applied in the settled
 * ones -- so a side's pane is that side's file plus the other side's
 * non-conflicting changes
 */
export const merge3 = (base: string, ours: string, theirs: string): Merge3 => {
  if (ours === theirs) return { kind: "clean", text: ours };
  if (ours === base) return { kind: "clean", text: theirs };
  if (theirs === base) return { kind: "clean", text: ours };

  const b = base.split("\n");
  const hunks = [
    ...hunksOf(b, ours.split("\n"), "ours"),
    ...hunksOf(b, theirs.split("\n"), "theirs"),
  ].sort((x, y) => x.start - y.start || x.end - y.end);

  const chunks: Chunk[] = [];
  /** Settled lines since the last conflict, coalesced into one chunk */
  let out: string[] = [];
  /** Where a side's changes landed in `out` */
  let changes: SettledChange[] = [];
  let at = 0;

  /** `out` as a chunk, with its changes when it has any */
  const settle = () => {
    if (!out.length) return;
    chunks.push(
      changes.length
        ? { kind: "settled", lines: out, changes }
        : { kind: "settled", lines: out }
    );
    out = [];
    changes = [];
  };
  /** Settle `lines`, changed by `by` */
  const changed = (lines: string[], by: SettledChange["by"]) => {
    changes.push({ start: out.length, count: lines.length, by });
    out.push(...lines);
  };

  for (let i = 0; i < hunks.length; ) {
    // One group: every hunk that overlaps or touches the region so far. Two
    // hunks from the same side never do -- a diff separates them by at least
    // one unchanged line -- so a group with one side in it is just that edit.
    const group = [hunks[i]];
    let end = hunks[i].end;
    for (i++; i < hunks.length && hunks[i].start <= end; i++) {
      group.push(hunks[i]);
      end = Math.max(end, hunks[i].end);
    }
    const start = group[0].start;

    /** `base[start, end)` with one side's hunks applied */
    const render = (side: Hunk["side"]) => {
      const result: string[] = [];
      let pos = start;
      for (const hunk of group.filter((h) => h.side === side)) {
        result.push(...b.slice(pos, hunk.start), ...hunk.lines);
        pos = hunk.end;
      }
      result.push(...b.slice(pos, end));
      return result;
    };

    out.push(...b.slice(at, start));
    const sides = new Set(group.map((h) => h.side));
    if (sides.size === 1) {
      changed(render(group[0].side), group[0].side);
    } else {
      const mine = render("ours");
      // Both sides made the same change: nothing to decide. Compared line by
      // line, since joining would make a deleted line and a blanked one equal.
      const yours = render("theirs");
      if (mine.length !== yours.length || mine.some((l, k) => l !== yours[k])) {
        settle();
        chunks.push({
          kind: "conflict",
          base: b.slice(start, end),
          ours: mine,
          theirs: yours,
        });
      } else {
        changed(mine, "both");
      }
    }
    at = end;
  }

  out.push(...b.slice(at));
  if (!chunks.length) return { kind: "clean", text: out.join("\n") };
  settle();
  return { kind: "conflict", chunks };
};

/** The line breaks a text uses: `\r\n`, a bare `\n`, a lone `\r` */
const breaksIn = (text: string) => {
  const found = new Set<"crlf" | "lf" | "cr">();
  if (text.includes("\r\n")) found.add("crlf");
  if (/(^|[^\r])\n/.test(text)) found.add("lf");
  if (/\r(?!\n)/.test(text)) found.add("cr");
  return found;
};

/**
 * Whether these copies of a file break lines in more than one way between
 * them, or with a lone `\r`.
 *
 * The resolve view shows a file's lines in Monaco, which breaks a line at a
 * lone `\r` and rewrites every break to one kind; `merge3` splits on `\n`
 * alone. For such a file the two count lines differently, so hunk positions
 * cannot be trusted, and every take would read back different bytes from
 * the editor. A file that uses one kind throughout, `\r\n` included, shows
 * exactly as it is.
 */
export const mixesLineBreaks = (...copies: string[]) => {
  const kinds = new Set(copies.flatMap((copy) => [...breaksIn(copy)]));
  return kinds.size > 1 || kinds.has("cr");
};

export interface MergeInput {
  /** The mark's `files`: what both sides last agreed on */
  base: FileHashes;
  baseContents: BaseContents;
  local: Record<string, string>;
  localHashes: FileHashes;
  server: Record<string, string>;
  serverHashes: FileHashes;
}

/**
 * A user file both sides changed in a way nothing here is entitled to decide,
 * with what the user needs to decide it.
 *
 * - `lines`: `merge3` ran and found lines both changed; `chunks` is the whole
 *   file.
 * - `whole`: no hunks to be had -- no base was captured, the base kept is
 *   not the agreement's, one side deleted the file, or the copies break
 *   lines in ways the view cannot show line by line (`mixesLineBreaks`).
 *   The file is one question. A side that deleted it has no content and no
 *   hash.
 *
 * - `settled`: never in a plan. A file a refused answer was about that now
 *   merges on its own, raised again beside the files still in conflict so
 *   the view can show where it stands (`PgProjectSync.mergeWithServer`).
 *   `content` is what it merges to, absent when the merge leaves no file.
 *
 * The hashes are the plan's own `localHashes` / `serverHashes` for the path:
 * an answer carries them back (`ResolvedFiles`), and is applied only to the
 * same two copies.
 */
export type FileConflict =
  | {
      kind: "lines";
      path: string;
      chunks: Chunk[];
      localHash: string;
      serverHash: string;
    }
  | {
      kind: "whole";
      path: string;
      local?: string;
      server?: string;
      localHash?: string;
      serverHash?: string;
    }
  | {
      kind: "settled";
      path: string;
      content?: string;
      localHash?: string;
      serverHash?: string;
    };

/**
 * The user's own content for conflicted files, keyed by path.
 *
 * `content: null` deletes the file. `localHash` and `serverHash` are the
 * `FileConflict`'s hashes the answer was made against, absent for a side
 * that had deleted the file; `PgProjectSync.mergeWithServer` applies the
 * answer only while both copies still hash to them.
 */
export type ResolvedFiles = Record<
  string,
  { content: string | null; localHash?: string; serverHash?: string }
>;

export interface MergePlan {
  /** Every path that settled on its own, with the content it settled on */
  files: Record<string, string>;
  /** Files both sides changed in a way nothing here is entitled to decide */
  conflicts: FileConflict[];
}

/**
 * Decide, file by file, what a project should hold once both sides' changes
 * are in.
 *
 * The base is what makes this possible. Comparing two copies says only *that*
 * a file differs; the base says which side changed it, and a file only one
 * side changed has an obvious answer.
 *
 * The generated workspace files are never merged and never asked about. Nobody
 * types them: the keypair is regenerated on open and the tutorial files follow
 * the reader. When both sides changed one, the account's copy wins, which
 * keeps the program at the address the account already deploys to -- except
 * that a keypair only this device holds is carried into it.
 *
 * A user file both changed is merged line by line when the base content kept
 * for it is the agreement's; what overlaps comes back as a `lines` conflict.
 * Without that base, with a side that deleted it, or with line breaks the
 * view cannot show line by line, it is a `whole` one.
 */
export const planMerge = (input: MergeInput): MergePlan => {
  const { base, baseContents, local, localHashes, server, serverHashes } =
    input;
  const files: Record<string, string> = {};
  const conflicts: FileConflict[] = [];

  const paths = new Set([
    ...Object.keys(base),
    ...Object.keys(localHashes),
    ...Object.keys(serverHashes),
  ]);

  for (const path of [...paths].sort()) {
    const b = base[path];
    const l = localHashes[path];
    const s = serverHashes[path];
    // `undefined` is "absent", so a delete is just another value here
    const take = (from: Record<string, string>) => {
      if (path in from) files[path] = from[path];
    };

    if (l === s) take(local);
    else if (l === b) take(server);
    else if (s === b) take(local);
    else if (!isUserFile(path)) {
      take(path in server ? server : local);
      // The account's copy winning must not cost this device a keypair the
      // account lacks, or the next build moves the program to a new address
      if (path === PROGRAM_INFO_PATH && path in server) {
        files[path] = keepLocalKeypair(local[path], server[path])!;
      }
    } else {
      const ancestor = baseContents[path];
      if (
        b === undefined ||
        ancestor?.hash !== b ||
        !(path in local) ||
        !(path in server)
      ) {
        const whole: FileConflict = { kind: "whole", path };
        if (path in local) {
          whole.local = local[path];
          whole.localHash = l;
        }
        if (path in server) {
          whole.server = server[path];
          whole.serverHash = s;
        }
        conflicts.push(whole);
        continue;
      }
      const merged = merge3(ancestor.content, local[path], server[path]);
      if (merged.kind === "clean") files[path] = merged.text;
      else if (mixesLineBreaks(ancestor.content, local[path], server[path])) {
        conflicts.push({
          kind: "whole",
          path,
          local: local[path],
          server: server[path],
          localHash: l,
          serverHash: s,
        });
      } else {
        conflicts.push({
          kind: "lines",
          path,
          chunks: merged.chunks,
          localHash: l!,
          serverHash: s!,
        });
      }
    }
  }

  return { files, conflicts };
};

/**
 * A plan's settled files, plus each conflicted file as the user answered.
 *
 * @param prefer `"local"` or `"server"` takes that side's copy of every
 * conflicted file, or deletes it where that side has none. A `ResolvedFiles`
 * takes the content given for each, deleting on `null`; its hashes are the
 * caller's to check, against the same plan. Entries for paths that are not in
 * conflict are ignored -- what merged stays merged.
 * @throws when a `ResolvedFiles` has no entry for a conflicted file: leaving
 * it out of the result would delete it
 */
export const settleConflicts = (
  plan: MergePlan,
  prefer: "local" | "server" | ResolvedFiles,
  local: Record<string, string>,
  server: Record<string, string>
) => {
  const files = { ...plan.files };
  if (typeof prefer === "object") {
    for (const { path } of plan.conflicts) {
      if (!Object.prototype.hasOwnProperty.call(prefer, path)) {
        throw new Error(`settle conflicts: no answer for ${path}`);
      }
      const { content } = prefer[path];
      if (content !== null) files[path] = content;
    }
    return files;
  }
  const from = prefer === "local" ? local : server;
  for (const { path } of plan.conflicts) {
    if (path in from) files[path] = from[path];
  }
  return files;
};

/**
 * The base store once a merge has adopted the server's copy as the new
 * agreement.
 *
 * Every user file where the merged result still differs from the server is,
 * from here on, a local change against the server's version -- so the server's
 * version is its base, and is what a merge would need if the server moves
 * again before this device's upload lands.
 */
export const baseAfterMerge = (
  merged: Record<string, string>,
  server: Record<string, string>,
  serverHashes: FileHashes
): BaseContents =>
  Object.fromEntries(
    Object.keys(server)
      .filter((path) => isUserFile(path) && merged[path] !== server[path])
      .map((path) => [
        path,
        { hash: serverHashes[path], content: server[path] },
      ])
  );

/** Whether two file maps hold exactly the same paths and contents */
export const sameFiles = (
  a: Record<string, string>,
  b: Record<string, string>
) => {
  const paths = Object.keys(a);
  return (
    paths.length === Object.keys(b).length &&
    paths.every((path) => path in b && a[path] === b[path])
  );
};
