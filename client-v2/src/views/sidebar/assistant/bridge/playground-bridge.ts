import {
  contextPathsWith,
  normalizeProjectPath,
  PgAssistantContext,
} from "@/entities/assistant-context";

import {
  PgBlockExplorer,
  PgCommand,
  PgConnection,
  PgExplorer,
  PgGlobal,
  PgProgramInfo,
  PgWallet,
} from "../../../../utils";
import { PgLesson } from "../../../flow/lessons";
import { PgBuildOutput, stripKnownNoise } from "./build-output";
import type { LessonContext } from "./lesson-context";
import { describeLesson } from "./lesson-context";

/** A condensed view of the program's interface, cheaper than the whole IDL */
export interface IdlSummary {
  name: string;
  instructions: string[];
  accounts: string[];
}

/** What the assistant is allowed to know about the project without asking */
export interface ProjectContext {
  workspaceName: string | null;
  /** Relative path of the file the user is looking at */
  currentFilePath: string | null;
  /**
   * The files in the conversation's context, in full: the open tabs and the
   * files the user added, minus the ones they removed. No other file of the
   * project is named here, so the user decides what reaches the model (HOO-2424)
   */
  contextFiles: { path: string; content: string }[];
  /** Compiler output from the last failed build, noise removed */
  buildError: string | null;
  /** Program interface, available only after a successful Anchor build */
  idl: IdlSummary | null;
  programId: string | null;
  deployState: "ready" | "loading" | "paused" | "cancelled";
  cluster: string;
  walletConnected: boolean;
  /** The lesson step the learner is on, when they are in a lesson */
  lesson: LessonContext | null;
}

/** A change the assistant proposes to one file */
export interface Patch {
  /** Relative path, e.g. `src/lib.rs` */
  path: string;
  /** Full new content of the file */
  content: string;
}

/**
 * Everything the assistant can do to the playground.
 *
 * This is the seam: one interface, a real implementation and a mock one. The
 * real implementation is the default because most of it is genuinely real —
 * only the model call is simulated when there is no key.
 *
 * Reading is free on this side; what reaches the model is limited to the
 * conversation's context by the tools and the prompt. Everything that
 * writes, builds or deploys is called only after the user has approved it in
 * the UI — the bridge does not gate, the caller does.
 */
export interface PlaygroundBridge {
  getProjectContext(): ProjectContext;
  /** Every file of the project; for the + menu, never sent to the model */
  listFiles(): string[];
  /** Relative paths of the editor's open tabs, in tab order */
  listOpenFiles(): string[];
  /** Relative paths of the files in the conversation's context */
  listContextFiles(): string[];
  /**
   * A path the model wrote (`/src/lib.rs`, `./src/lib.rs`) as `src/lib.rs`,
   * or `undefined` when it names nothing in the project
   */
  toProjectPath(path: string): string | undefined;
  /**
   * Any file of the project, context or not: for the approval card and the
   * tools' own checks. What the model may read goes through `read_file`,
   * which checks `listContextFiles()` first; a new reader for the model must
   * do the same
   */
  readFile(path: string): string | null;
  applyPatch(patch: Patch): Promise<void>;
  /** Removes a file; what Undo patch does to a file the patch created */
  deleteFile(path: string): Promise<void>;
  build(): Promise<void>;
  /** @returns where the deployed program can be seen, when that is known */
  deploy(): Promise<{ programId: string; explorerUrl: string } | null>;
}

const toRelative = (fullPath: string) => {
  try {
    return PgExplorer.getRelativePath(fullPath);
  } catch {
    return fullPath;
  }
};

const summarizeIdl = (): IdlSummary | null => {
  const idl = PgProgramInfo.idl;
  if (!idl) return null;

  return {
    name: idl.name,
    instructions: idl.instructions?.map((ix) => ix.name) ?? [],
    accounts: idl.accounts?.map((acc) => acc.name) ?? [],
  };
};

/** The real playground. */
export const realBridge: PlaygroundBridge = {
  getProjectContext() {
    const currentFullPath = PgExplorer.currentFilePath;
    const build = PgBuildOutput.latest;

    return {
      workspaceName: PgExplorer.currentWorkspaceName ?? null,
      currentFilePath: currentFullPath ? toRelative(currentFullPath) : null,
      // A file that cannot be read now (deleted between the listing and the
      // read) is left out rather than sent as empty, which the model would
      // take for the file's content
      contextFiles: this.listContextFiles().flatMap((path) => {
        const content = this.readFile(path);
        return content === null ? [] : [{ path, content }];
      }),
      buildError: build && build.failed ? stripKnownNoise(build.stderr) : null,
      idl: summarizeIdl(),
      programId: PgProgramInfo.getPkStr() ?? null,
      deployState: PgGlobal.deployState,
      cluster: PgConnection.current.rpcEndpoint,
      walletConnected: !!PgWallet.current,
      lesson: describeLesson(PgLesson.state),
    };
  },

  listFiles() {
    return (
      PgExplorer.getAllFiles()
        .map(([path]) => toRelative(path))
        // `.workspace/` holds editor and program metadata, not the user's project
        .filter((path) => !path.startsWith(".workspace"))
    );
  },

  listOpenFiles() {
    return PgExplorer.tabs.map(toRelative);
  },

  listContextFiles() {
    const files = new Set(this.listFiles());
    return contextPathsWith((path) => files.has(path))(
      this.listOpenFiles(),
      PgAssistantContext.choice(PgExplorer.currentWorkspaceId)
    );
  },

  toProjectPath(path) {
    // The full path the explorer itself uses, `/<workspace>/src/lib.rs`, is
    // relative once its workspace prefix goes; anything else is read as
    // relative to the project root
    const name = PgExplorer.currentWorkspaceName;
    const prefix = name ? `/${name}/` : undefined;
    const trimmed = path.trim();
    return normalizeProjectPath(
      prefix && trimmed.startsWith(prefix)
        ? trimmed.slice(prefix.length)
        : trimmed
    );
  },

  readFile(path) {
    return (
      PgExplorer.getFileContent(PgExplorer.convertToFullPath(path)) ?? null
    );
  },

  async applyPatch({ path, content }) {
    const fullPath = PgExplorer.convertToFullPath(path);

    // Write without touching tabs; the editor is synced separately below
    await PgExplorer.createItem(fullPath, content, {
      override: true,
      openOptions: { dontOpen: true },
    });

    /**
     * Push the new text into the editor too.
     *
     * Writing alone is not enough: when a file is reopened, the editor reuses
     * an existing Monaco model if one exists for that path
     * (`components/Editor/Monaco/Monaco.tsx`), and that model still holds the
     * old text. So a patch applied to the file the user is looking at would be
     * saved correctly and stay invisible until a reload.
     *
     * Setting the model's value also gives the user a normal editor undo.
     */
    const monaco = await import("monaco-editor");
    const model = monaco.editor
      .getModels()
      .find((m) => m.uri.path === fullPath);
    if (model && model.getValue() !== content) model.setValue(content);
  },

  async deleteFile(path) {
    await PgExplorer.deleteItem(PgExplorer.convertToFullPath(path));
  },

  async build() {
    await PgCommand.build.execute();
  },

  async deploy() {
    await PgCommand.deploy.execute();

    // The deploy command prints the transaction to the terminal but does not
    // return it; the program address is the stable thing to link to.
    const programId = PgProgramInfo.getPkStr();
    if (!programId) return null;
    return {
      programId,
      explorerUrl: PgBlockExplorer.current.getAddressUrl(programId),
    };
  },
};

// A deleted file's choices go with it, so a new file made at its path is not
// in the context until the user adds it. Here, not in the composer: the
// store outlives the panel, and a delete while it is closed counts too
PgExplorer.onDidDeleteItem((fullPath) => {
  const path = realBridge.toProjectPath(fullPath);
  if (path) {
    PgAssistantContext.forget(PgExplorer.currentWorkspaceId, path);
  }
});

// A renamed file or folder keeps its choices under its new path: a removal is
// the user keeping a file from the model provider, and a rename must not undo
// it. A workspace's own rename resolves to no project path and is skipped
PgExplorer.onDidMoveItem(({ from, to }) => {
  const before = realBridge.toProjectPath(from);
  const after = realBridge.toProjectPath(to);
  if (before && after) {
    PgAssistantContext.move(PgExplorer.currentWorkspaceId, {
      from: before,
      to: after,
    });
  }
});
