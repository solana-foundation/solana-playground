import { PgBuildOutput, stripKnownNoise } from "./build-output";
import { describeLesson } from "./lesson-context";
import type { LessonContext } from "./lesson-context";
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
  /** Content of that file */
  currentFileContent: string | null;
  /** Relative paths of every open editor tab, the current one included */
  openFilePaths: string[];
  /** Relative paths of every file in the project */
  filePaths: string[];
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
 * Reading is free. Everything that writes, builds or deploys is called only
 * after the user has approved it in the UI — the bridge does not gate, the
 * caller does.
 */
export interface PlaygroundBridge {
  getProjectContext(): ProjectContext;
  listFiles(): string[];
  /** Relative paths of the editor's open tabs, in tab order */
  listOpenFiles(): string[];
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
      currentFileContent: currentFullPath
        ? PgExplorer.getFileContent(currentFullPath) ?? null
        : null,
      openFilePaths: this.listOpenFiles(),
      filePaths: this.listFiles(),
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
