import {
  contextPathsWith,
  normalizeProjectPath,
  PgAssistantContext,
} from "@/entities/assistant-context";
import { type Cluster, getKnownCluster } from "@/entities/cluster";
import { networkInSentence } from "@/features/deploy";
import { merge3 } from "@/features/persistence/model/merge";
import { createLogger } from "@/shared/lib/logger";

import { estimateDeployCostWithin } from "../../../../commands/deploy/estimate";
import {
  PgBlockExplorer,
  PgCommand,
  PgConnection,
  PgExplorer,
  PgGlobal,
  PgProgramInfo,
  PgWallet,
} from "../../../../utils";
import { PgBuildOutput, stripKnownNoise } from "./build-output";

/** A condensed view of the program's interface, cheaper than the whole IDL */
export interface IdlSummary {
  name: string;
  instructions: string[];
  accounts: string[];
  /** Why the Playground cannot call this IDL; absent when it can */
  refused?: string;
}

/**
 * The network the app is on, by name. A custom RPC's URL can carry its
 * provider's API key, so the assistant gets the cluster, never the address:
 * `custom` is an RPC on no known cluster, or one whose cluster is still being
 * read or could not be read (HOO-2878)
 */
export type AssistantCluster = Cluster | "custom";

/**
 * The wallets' public keys, base58: never a wallet or key object, whose
 * Playground keypair carries the secret key (HOO-2857)
 */
export interface WalletKeys {
  /** The selected Playground wallet account; absent before one exists */
  playground?: string;
  /** Wallets connected through ConnectorKit (Wallet Standard) */
  connected: string[];
  /** The wallet that signs and pays, one of the keys above; absent while none is connected */
  signing?: string;
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
  cluster: AssistantCluster;
  wallets: WalletKeys;
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
  /**
   * Remembers the RPC endpoint now and returns a check of whether another one
   * was selected since. The endpoint is compared inside the bridge and never
   * returned, since its URL can carry a key; a cluster resolving late is not a
   * change
   */
  watchConnection(): () => boolean;
  /** @returns where the deployed program can be seen, when that is known */
  deploy(): Promise<{ programId: string; explorerUrl: string } | null>;
  /**
   * @returns the network a deploy would go to, named as a sentence writes it
   * ("devnet", `undefined` while unknown), its estimated cost in lamports (`null`
   * when it cannot be estimated), and whether the Playground wallet pays
   */
  quoteDeploy(): Promise<{
    network: string | undefined;
    cost: number | null;
    playground: boolean;
  }>;
}

const toRelative = (fullPath: string) => {
  try {
    return PgExplorer.getRelativePath(fullPath);
  } catch {
    return fullPath;
  }
};

const summarizeIdl = (): IdlSummary | null => {
  const reading = PgProgramInfo.readIdl();
  // TODO(HOO-1765 task 1.4): the refused branch has no unit test (the bridge
  // reads the whole playground); `describeProject`'s test pins its wording
  if (reading?.kind === "refused") {
    const raw = PgProgramInfo.idl as {
      name?: unknown;
      metadata?: { name?: unknown };
    };
    const name = raw.metadata?.name ?? raw.name;
    return {
      name: typeof name === "string" ? name : "unknown",
      instructions: [],
      accounts: [],
      refused: reading.reason,
    };
  }
  const idl = PgProgramInfo.callableIdl();
  if (!idl) return null;

  return {
    name: idl.name,
    instructions: idl.instructions?.map((ix) => ix.name) ?? [],
    accounts: idl.accounts?.map((acc) => acc.name) ?? [],
  };
};

/** The real playground. */
/**
 * The text for a buffer the user typed into while a patch was being written:
 * the patch with the typing folded in, or the typing alone when the two
 * overlap, since autosave then writes it and a card can say the file moved on,
 * while lost typing cannot be told at all
 */
const foldTyping = ({
  base,
  typed,
  content,
}: {
  base: string;
  typed: string;
  content: string;
}) => {
  const merged = merge3(base, content, typed);
  return merged.kind === "clean" ? merged.text : typed;
};

const log = createLogger("assistant:bridge");

/**
 * The cluster the app is on; see {@link AssistantCluster}. A public or local
 * endpoint names its cluster at once; a custom one has it only once its
 * genesis hash is read, and until then `PgConnection.cluster` still names the
 * previous endpoint's, so a stale read counts as no cluster
 */
const currentCluster = (): AssistantCluster =>
  getKnownCluster(PgConnection.current.rpcEndpoint) ??
  (PgConnection.clusterIsStale ? undefined : PgConnection.cluster) ??
  "custom";

const toBase58 = (key: { toBase58(): string } | null | undefined) =>
  key?.toBase58();

/**
 * The selected Playground account's public key. A stored key that does not
 * parse gives none, rather than failing every assistant turn over one line of
 * context
 */
const playgroundKey = () => {
  const account = PgWallet.accounts[PgWallet.currentIndex];
  if (!account) return undefined;
  try {
    return toBase58(PgWallet.create(account).publicKey);
  } catch {
    // Never the error: it is about the secret key
    log.warn("the Playground wallet's stored key does not parse; left out", {
      report: true,
    });
    return undefined;
  }
};

/** The wallets' public keys; see {@link WalletKeys} */
const currentWalletKeys = (): WalletKeys => {
  return {
    playground: playgroundKey(),
    connected: PgWallet.getConnectedStandardWallets().flatMap((wallet) => {
      const key = toBase58(wallet.publicKey);
      return key ? [key] : [];
    }),
    signing: toBase58(PgWallet.current?.publicKey),
  };
};

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
      cluster: currentCluster(),
      wallets: currentWalletKeys(),
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
    const fullPath = PgExplorer.convertToFullPath(path);
    const saved = PgExplorer.getFileContent(fullPath);
    // eslint-disable-next-line unicorn/no-null -- `PlaygroundBridge.readFile` types an absent file as null
    if (saved === undefined) return null;
    // Autosave lags typing by about 500 ms, so the explorer can be behind what
    // the user sees: Undo would pass its check and overwrite the new typing
    return PgExplorer.editorBuffers?.read(fullPath) ?? saved;
  },

  async applyPatch({ path, content }) {
    const fullPath = PgExplorer.convertToFullPath(path);
    const buffered = PgExplorer.editorBuffers?.read(fullPath);

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
    if (!model) return;
    const live = model.getValue();
    const text =
      buffered === undefined || live === buffered
        ? content
        : foldTyping({ base: buffered, typed: live, content });
    if (live !== text) model.setValue(text);
  },

  async deleteFile(path) {
    await PgExplorer.deleteItem(PgExplorer.convertToFullPath(path));
  },

  async build() {
    await PgCommand.build.execute();
  },

  watchConnection() {
    const endpoint = PgConnection.current.rpcEndpoint;
    return () => PgConnection.current.rpcEndpoint !== endpoint;
  },

  async quoteDeploy() {
    const cluster = PgConnection.cluster;
    return {
      network: networkInSentence(cluster),
      cost: await estimateDeployCostWithin(),
      // No wallet yet: the Playground wallet is made on the deploy and pays
      playground: !PgWallet.current || PgWallet.current.isPg === true,
    };
  },

  async deploy() {
    // The command pauses or resumes a deploy that is already running and
    // returns nothing; that press deployed nothing, so it is not a success
    if (PgGlobal.deployState !== "ready") throw new Error(DEPLOY_BUSY);
    const result = await PgCommand.deploy.execute();
    if (!result) throw new Error(DEPLOY_BUSY);

    // The program address is the stable thing to link to: an upgrade keeps
    // it, while the transaction differs on every deploy.
    const programId = PgProgramInfo.getPkStr();
    if (!programId) return null;
    return {
      programId,
      explorerUrl: PgBlockExplorer.current.getAddressUrl(programId),
    };
  },
};

/** Why the assistant's deploy did nothing: another deploy holds the command */
const DEPLOY_BUSY = "Another deploy is running; nothing was deployed.";

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
