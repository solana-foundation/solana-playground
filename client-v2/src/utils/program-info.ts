import type { Idl } from "@coral-xyz/anchor";
import { decodeIdlAccount, idlAddress } from "@coral-xyz/anchor/dist/cjs/idl";

import { type IdlReading, type IdlV1, readIdl } from "../entities/idl";
import { createLogger } from "../shared/lib/logger";
import { PgCodec } from "./codec";
import { PgCommand } from "./command";
import { PgCommon } from "./common";
import { PgConnection } from "./connection";
import {
  createDerivable,
  declareDecorator,
  derivable,
  initable,
  updatable,
} from "./decorators";
import { PgExplorer } from "./explorer";
import { writeWorkspaceFile } from "./explorer/workspace-file";
import type { Nullable } from "./types";
import { PgWeb3 } from "./web3";

const log = createLogger("program-info:storage");
const fetchLog = createLogger("program-info:fetch");

/** Program info state */
type ProgramInfo = Nullable<{
  /** Program's build server uuid */
  uuid: string;
  /** Program's keypair */
  kp: PgWeb3.Keypair;
  /** Program's custom public key */
  customPk: PgWeb3.PublicKey;
  /** Program's Anchor IDL, 0.29 or 1.x, as it arrived; read it through `readIdl` */
  idl: Idl | IdlV1;
  /** Imported program binary file */
  importedProgram: {
    bytes: Uint8Array;
    fileName: string;
  };
  /** Whether the last build failed */
  lastBuildFailed: boolean;
}>;

/** Serialized program info that's used in storage */
type SerializedProgramInfo = Nullable<{
  uuid: string;
  kp: Array<number>;
  customPk: string;
  idl: Idl | IdlV1;
  lastBuildFailed: boolean;
}>;

const defaultState: ProgramInfo = {
  uuid: null,
  kp: null,
  customPk: null,
  idl: null,
  importedProgram: null,
  lastBuildFailed: null,
};

const storage = {
  /** Relative path to program info */
  PATH: PgCommon.joinPaths(
    PgExplorer.PATHS.WORKSPACE_DIRNAME,
    "program-info.json"
  ),

  /** Read from storage and deserialize the data. */
  async read(): Promise<ProgramInfo> {
    if (!PgExplorer.isInitialized || !PgExplorer.currentWorkspaceName) {
      return defaultState;
    }

    let serializedState: SerializedProgramInfo;
    try {
      serializedState = await PgExplorer.fs.readToJSON(this.PATH);
    } catch {
      return defaultState;
    }

    return {
      ...defaultState,
      ...serializedState,
      kp: serializedState.kp
        ? PgWeb3.Keypair.fromSecretKey(Uint8Array.from(serializedState.kp))
        : null,
      customPk: serializedState.customPk
        ? new PgWeb3.PublicKey(serializedState.customPk)
        : null,
    };
  },

  /**
   * Serialize the data and write it with `writeWorkspaceFile`: a reload right
   * after the write that creates the file would otherwise lose it, and with
   * it the program's keypair.
   */
  async write(state: ProgramInfo) {
    if (!PgExplorer.isInitialized || !PgExplorer.currentWorkspaceName) return;

    // Don't use spread operator(...) because of the extra state
    const serializedState: SerializedProgramInfo = {
      uuid: state.uuid,
      idl: state.idl,
      kp: state.kp ? Array.from(state.kp.secretKey) : null,
      customPk: state.customPk?.toBase58() ?? null,
      lastBuildFailed: state.lastBuildFailed,
    };

    // `updatable` calls this without awaiting it, so a failure is logged
    // here; rethrown, it would be an unhandled rejection naming nothing
    try {
      await writeWorkspaceFile(this.PATH, JSON.stringify(serializedState));
    } catch (e) {
      log.error(e, { report: true });
    }
  },
};

const onDidInit = () => {
  // Refresh state on project change
  return PgCommon.batchChanges(PgProgramInfo.refresh, [
    PgExplorer.onDidInit,
    PgExplorer.onDidSwitchWorkspace,
  ]);
};

const derive = () => ({
  /**
   * Get the program's public key.
   *
   * Custom public key has priority if it's specified.
   */
  pk: createDerivable({
    derive: (): PgWeb3.PublicKey | null => {
      if (PgProgramInfo.customPk) return PgProgramInfo.customPk;
      if (PgProgramInfo.kp) return PgProgramInfo.kp.publicKey;
      return null;
    },
    onChange: ["kp", "customPk"],
    infallible: true,
  }),

  /** On-chain data of the program */
  onChain: createDerivable({
    // No id, nothing to fetch: `undefined` is "not known yet". `null` is any
    // failed fetch, which Interact (`interactSurface`) shows as "can't reach
    // the network", so it must not stand for a missing id
    // (Typed by hand: inferring it through `PgProgramInfo.pk` would make the
    // class's type depend on itself)
    derive: (): ReturnType<typeof _PgProgramInfo.fetch> | undefined =>
      PgProgramInfo.pk ? _PgProgramInfo.fetch() : undefined,
    onChange: ["pk", PgConnection.onDidChange, PgCommand.deploy.onDidFinish],
  }),
});

// TODO: Remove in 2024
const migrate = () => {
  // Removing the `program-info` key is enough for migration because the data
  // is already stored in `indexedDB`
  localStorage.removeItem("programInfo");
};

/** The program data's header: tag (4), slot (8), authority option (1 + 32) */
const PROGRAM_DATA_HEADER_LEN = 45;

/**
 * The program data's full length. The RPC reports it as `space` beside a
 * sliced read; web3.js 1.98 keeps the field without typing it. Without it
 * this reads the whole account, the slow path a large program pays, so the
 * fallback is logged.
 */
const programDataLenWith =
  (conn: typeof PgConnection.current) =>
  async (
    programDataPk: InstanceType<typeof PgWeb3.PublicKey>,
    sliced: { data: Buffer }
  ) => {
    // A `space` below the slice is an RPC answering with the slice's length
    if (
      "space" in sliced &&
      typeof sliced.space === "number" &&
      sliced.space >= sliced.data.length
    ) {
      return sliced.space;
    }
    fetchLog.info("The RPC sent no `space`; reading the whole program data");
    const whole = await conn.getAccountInfo(programDataPk);
    // Closed between the two reads: no length, as for no account at all
    return whole?.data.length;
  };

@initable({ onDidInit })
@derivable(derive)
@updatable({ defaultState, storage, migrate })
class _PgProgramInfo {
  /** Get the current program's pubkey as base58 string. */
  static getPkStr() {
    return PgProgramInfo.pk?.toBase58() ?? null;
  }

  /** How the stored IDL reads, or `null` when there is none */
  static readIdl(): IdlReading | null {
    // eslint-disable-next-line unicorn/no-null -- `null` for no IDL is what every caller and mock of `readIdl()` reads
    return PgProgramInfo.idl ? readIdl(PgProgramInfo.idl) : null;
  }

  /**
   * The IDL in the 0.29 shape the client calls a program with, or `null`
   * when there is none or it was refused (`readIdl` says why).
   */
  static callableIdl(): Idl | null {
    const reading = _PgProgramInfo.readIdl();
    // eslint-disable-next-line unicorn/no-null -- `null` for no callable IDL is what every caller and mock of `callableIdl()` reads
    return reading && reading.kind !== "refused" ? reading.idl : null;
  }

  /** Why `callableIdl()` is null, worded for the person who hit it */
  static noCallableIdlMessage() {
    const reading = _PgProgramInfo.readIdl();
    if (reading?.kind === "refused") {
      return `The program's IDL can't be called: ${reading.reason}.`;
    }
    return "IDL not found, build the program to create the IDL.";
  }

  /** Get the JSON.stringified IDL from state. */
  static getIdlStr() {
    if (PgProgramInfo.idl) return JSON.stringify(PgProgramInfo.idl);
    return null;
  }

  /**
   * Fetch the on-chain program.
   *
   * @param programId optional program id
   * @returns program's on-chain data
   */
  static async fetch(programId: PgWeb3.PublicKey | null = PgProgramInfo.pk) {
    if (!programId) throw new Error("Program id doesn't exist");

    const conn = PgConnection.current;
    const programAccountInfo = await conn.getAccountInfo(programId);
    const deployed = !!programAccountInfo;
    if (!deployed) return { deployed, upgradable: true };

    // TODO: Also handle Loader v4?
    if (
      !programAccountInfo.owner.equals(
        PgWeb3.BpfLoaderUpgradeableProgram.programId
      )
    ) {
      return { deployed, upgradable: false };
    }

    const programDataPkBuffer = programAccountInfo.data.slice(4);
    const programDataPk = new PgWeb3.PublicKey(programDataPkBuffer);
    // Only the header is needed, and a large program's data runs to
    // megabytes (Drift on devnet: 7 MB, 9.3 MB as base64)
    const programDataAccountInfo = await conn.getAccountInfo(programDataPk, {
      dataSlice: { offset: 0, length: PROGRAM_DATA_HEADER_LEN },
    });
    if (!programDataAccountInfo) return { deployed, upgradable: true };

    // Check if program authority exists
    const authorityExists = programDataAccountInfo.data.at(12);
    const upgradable = !!authorityExists;
    if (!upgradable) return { deployed, upgradable };

    const programDataLen = await programDataLenWith(conn)(
      programDataPk,
      programDataAccountInfo
    );
    if (programDataLen === undefined) return { deployed, upgradable: true };

    const authorityBuffer = programDataAccountInfo.data.slice(13, 45);
    const authority = new PgWeb3.PublicKey(authorityBuffer);
    return { deployed, upgradable, authority, programDataLen };
  }

  /**
   * Fetch the Anchor IDL from chain.
   *
   * NOTE: This is a reimplementation of `anchor.Program.fetchIdl` because that
   * function only returns the IDL without the IDL authority.
   *
   * @param programId optional program id
   * @returns the IDL and the authority of the IDL or `null` if IDL doesn't exist
   */
  static async fetchIdl(programId = PgProgramInfo.pk) {
    if (!programId) throw new Error("Program id doesn't exist");

    const idlPk = await idlAddress(programId);
    const accountInfo = await PgConnection.current.getAccountInfo(idlPk);
    if (!accountInfo) return null;

    // Chop off account discriminator
    const idlAccount = decodeIdlAccount(accountInfo.data.slice(8));
    const { inflate } = await import("pako");
    const inflatedIdl = inflate(idlAccount.data);
    // Either version; readers go through `readIdl`
    const idl: Idl | IdlV1 = JSON.parse(PgCodec.decodeText(inflatedIdl));
    return { idl, authority: idlAccount.authority };
  }
}

export const PgProgramInfo = declareDecorator(_PgProgramInfo, {
  derivable: derive,
  updatable: { defaultState },
});
