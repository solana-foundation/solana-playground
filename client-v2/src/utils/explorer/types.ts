import type { TupleString } from "../types";

/** Playground explorer */
export interface Explorer {
  /** Explorer files */
  files: ExplorerFiles;
  /** Full path of the files in tabs */
  tabs: string[];
  /** Current file index(in tabs) */
  currentIndex: number;
}

/** Full path -> `ItemInfo` */
export type ExplorerFiles = Record<string, ItemInfo>;

/** `ItemInfo` with `path` property */
export interface FullFile extends ItemInfo {
  /** Path to the file */
  path: string;
}

/** File or directory item */
interface ItemInfo {
  /** Contents of the file */
  content?: string;
  /** Metadata about the file */
  meta?: ItemMeta;
}

/**
 * Item metadata file.
 *
 * Intentionally using an `Array` instead of a map to keep the tab order.
 */
export type ItemMetaFile = Array<
  {
    /** Relative path */
    path: string;
    /** Whether the file is in tabs */
    isTabs?: boolean;
    /** Whether the file is the current file */
    isCurrent?: boolean;
  } & ItemMeta
>;

/** Item metadata */
interface ItemMeta {
  /** Position data */
  position?: Position;
}

/** Editor position data */
export interface Position {
  /** Editor's visible top line number */
  topLineNumber: number;
  /** Editor cursor position */
  cursor: {
    /** Start index */
    from: number;
    /** End index */
    to: number;
  };
}

/** Folder content */
export interface Folder {
  /** Sub file names */
  files: string[];
  /** Sub folder names */
  folders: string[];
}

/** Array<[Path, Content]> */
export type TupleFiles = TupleString[];

/**
 * The editor's own copy of files, which can run ahead of the explorer's.
 *
 * Every path is a full path, `/<workspace>/<file>`. The editor keeps a model
 * per file it has opened and reuses it on the next open, so anything that
 * rewrites files underneath it has to update these too, or the editor goes
 * on showing -- and autosaving -- the old text.
 */
export interface EditorBuffers {
  /** The buffer's current text, or `undefined` when there is none */
  read(path: string): string | undefined;
  /** Replace the buffer's text, as one undoable edit */
  write(path: string, content: string): void;
  /** Drop the buffer of a file that no longer exists */
  discard(path: string): void;
}
