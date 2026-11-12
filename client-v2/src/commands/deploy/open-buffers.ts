import { createLogger } from "@/shared/lib/logger";

import {
  removeConfigFile,
  writeConfigFile,
} from "../../utils/explorer/config-file";
import { PgFs } from "../../utils/explorer/fs";

const log = createLogger("commands:deploy");

/**
 * Next to the chat threads and sync marks, in the code's IndexedDB volume.
 * One file per buffer, so two deploys (two tabs) never rewrite each other's
 * record.
 */
const DIR = "/.config/deploy/open-buffers";
const pathOf = (address: string) => `${DIR}/${address}.json`;

/**
 * A deploy's buffer account that may still hold its rent: written before the
 * buffer is created and removed once the deploy consumes it or a close lands,
 * so one a failed close, a stuck RPC or a closed tab left behind stays on
 * record. Nothing offers the reclaim yet; it is a follow-up. The loader's
 * `Close` takes the authority's signature, and the buffer exists only on its
 * own network.
 */
export interface OpenBuffer {
  /** The buffer account's address */
  address: string;
  /**
   * Who can close it: the Playground wallet, or the standard wallet after
   * `setBufferAuthority`. A hint: a hand-over still in flight can land after
   * the record, so a reclaim reads the authority from the buffer itself.
   */
  authority: string;
  /** The RPC endpoint the deploy ran on */
  endpoint: string;
  /** Its network, when it was read */
  cluster: string | null;
  /** When the deploy last recorded it, ISO 8601 (`toISOString`) */
  at: string;
}

/** Whether a parsed record has the shape a reclaim needs */
const isOpenBuffer = (value: unknown): value is OpenBuffer => {
  const b = value as Partial<OpenBuffer> | null;
  return (
    typeof b?.address === "string" &&
    typeof b.authority === "string" &&
    typeof b.endpoint === "string" &&
    typeof b.at === "string" &&
    !Number.isNaN(Date.parse(b.at))
  );
};

const isMissing = (e: unknown) =>
  (e as { code?: string } | null)?.code === "ENOENT";

/**
 * The buffers recorded as possibly holding rent, oldest first. A record that
 * cannot be parsed is skipped and reported; no directory is no buffers.
 */
export const listOpenBuffers = async (): Promise<OpenBuffer[]> => {
  let names: string[];
  try {
    names = await PgFs.readDir(DIR);
  } catch (e) {
    if (!isMissing(e)) {
      log.error(e, { report: true, context: { action: "list open buffers" } });
    }
    return [];
  }
  const buffers: OpenBuffer[] = [];
  for (const name of names) {
    try {
      const record = await PgFs.readToJSON<unknown>(`${DIR}/${name}`);
      if (!isOpenBuffer(record)) throw new Error("not an open buffer record");
      buffers.push(record);
    } catch (e) {
      log.error(e, {
        report: true,
        context: { action: "read an open buffer", name },
      });
    }
  }
  return buffers.sort((a, b) => a.at.localeCompare(b.at));
};

/**
 * Record `buffer`, replacing an earlier record of the same address. A lost
 * write must not fail the deploy that asked for it, so it is reported instead.
 */
export const recordOpenBuffer = async (buffer: OpenBuffer) => {
  try {
    await writeConfigFile(pathOf(buffer.address), JSON.stringify(buffer));
  } catch (e) {
    log.error(e, { report: true, context: { action: "record open buffer" } });
  }
};

/** Drop the record of `address`: the buffer is consumed or closed */
export const forgetOpenBuffer = async (address: string) => {
  try {
    await removeConfigFile(pathOf(address));
  } catch (e) {
    if (isMissing(e)) return;
    log.error(e, { report: true, context: { action: "forget open buffer" } });
  }
};
