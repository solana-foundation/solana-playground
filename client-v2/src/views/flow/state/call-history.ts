import { createLogger } from "@/shared/lib/logger";
import type { Disposable } from "../../../utils";

const log = createLogger("flow:call-history");

/** One finished Interact call, as the stage's history lists it */
export interface CallRecord {
  id: string;
  programId: string;
  cluster: string;
  instruction: string;
  ok: boolean;
  signature: string | null;
  /** The log line that explains a failure, null on success */
  failingLine: string | null;
  at: number;
}

const KEY = "flow.calls";
// Shared by every program and network this browser has called, and
// `localStorage` is near its origin budget: keep it short and keep no logs.
const MAX_RECORDS = 50;

const isNullableString = (v: unknown) => v === null || typeof v === "string";

/** Guards against hand-edited or corrupted `localStorage` */
const isCallRecord = (r: unknown): r is CallRecord => {
  if (!r || typeof r !== "object") return false;
  const rec = r as Record<string, unknown>;
  return (
    typeof rec.id === "string" &&
    typeof rec.programId === "string" &&
    typeof rec.cluster === "string" &&
    typeof rec.instruction === "string" &&
    typeof rec.ok === "boolean" &&
    isNullableString(rec.signature) &&
    isNullableString(rec.failingLine) &&
    typeof rec.at === "number"
  );
};

/** Every call this browser has made from Interact, newest first */
export class PgCallHistory {
  /** The calls to one program on one network, newest first */
  static list(programId: string, cluster: string): CallRecord[] {
    return PgCallHistory._all().filter(
      (r) => r.programId === programId && r.cluster === cluster
    );
  }

  static add(r: Omit<CallRecord, "id" | "at">): CallRecord {
    const at = Date.now();
    // The sequence keeps two calls in one millisecond apart
    const id = `${r.programId}-${at}-${PgCallHistory._seq++}`;
    // Named field by field, so nothing a caller adds (logs) reaches storage
    const record: CallRecord = {
      id,
      programId: r.programId,
      cluster: r.cluster,
      instruction: r.instruction,
      ok: r.ok,
      signature: r.signature,
      failingLine: r.failingLine,
      at,
    };
    const stored = PgCallHistory._read();
    // A blob that does not parse is left alone rather than overwritten
    if (stored === null) return record;
    try {
      const all = [record, ...stored].slice(0, MAX_RECORDS);
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) {
      // A full origin must not turn a finished call into a failed one, but
      // the lost record is reported
      log.error(e, {
        report: true,
        context: { what: "save the call history" },
      });
    }
    for (const cb of PgCallHistory._listeners) cb();
    return record;
  }

  static onDidChange(cb: () => void): Disposable {
    PgCallHistory._listeners.add(cb);
    cb();
    return { dispose: () => PgCallHistory._listeners.delete(cb) };
  }

  private static _all(): CallRecord[] {
    return PgCallHistory._read() ?? [];
  }

  /** The stored records; null when the blob does not parse as a list */
  private static _read(): CallRecord[] | null {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (!Array.isArray(parsed)) throw new Error("Not a list");
      return parsed.filter(isCallRecord);
    } catch (e) {
      log.warn("The call history does not parse", { context: { error: e } });
      return null;
    }
  }

  private static _seq = 0;
  private static readonly _listeners = new Set<() => void>();
}

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach, vi } = import.meta.vitest;

  describe("views/flow/state/call-history", () => {
    const call = (programId: string, cluster: string, instruction: string) => ({
      programId,
      cluster,
      instruction,
      ok: true,
      signature: "sig",
      failingLine: null,
    });

    beforeEach(() => localStorage.clear());

    it("lists one program's calls on one network, newest first", () => {
      vi.spyOn(Date, "now").mockReturnValueOnce(1).mockReturnValueOnce(2);
      PgCallHistory.add(call("P", "devnet", "initialize"));
      PgCallHistory.add(call("P", "devnet", "increment"));
      vi.restoreAllMocks();
      PgCallHistory.add(call("P", "testnet", "increment"));
      PgCallHistory.add(call("Q", "devnet", "increment"));

      expect(
        PgCallHistory.list("P", "devnet").map((r) => r.instruction)
      ).toEqual(["increment", "initialize"]);
    });

    it("keeps only the 50 newest calls", () => {
      for (let i = 0; i < 51; i++) {
        PgCallHistory.add(call("P", "devnet", `ix${i}`));
      }
      const list = PgCallHistory.list("P", "devnet");
      expect(list).toHaveLength(50);
      expect(list.at(-1)?.instruction).toBe("ix1");
      expect(new Set(list.map((r) => r.id)).size).toBe(50);
    });

    it("drops records a hand edit broke", () => {
      const good = {
        id: "a",
        programId: "P",
        cluster: "devnet",
        instruction: "increment",
        ok: false,
        signature: null,
        failingLine: "Error Code: X",
        at: 1,
      };
      const noInstruction = {
        id: "b",
        programId: "P",
        cluster: "devnet",
        ok: true,
        signature: null,
        failingLine: null,
        at: 2,
      };
      const badOk = {
        id: "c",
        programId: "P",
        cluster: "devnet",
        instruction: "x",
        ok: "yes",
        signature: null,
        failingLine: null,
        at: 3,
      };
      localStorage.setItem(KEY, JSON.stringify([good, noInstruction, badOk]));

      expect(PgCallHistory.list("P", "devnet")).toEqual([good]);
    });

    it("reads unparseable storage as empty and never overwrites it", () => {
      localStorage.setItem(KEY, "{not json");
      expect(PgCallHistory.list("P", "devnet")).toEqual([]);
      PgCallHistory.add(call("P", "devnet", "increment"));
      expect(localStorage.getItem(KEY)).toBe("{not json");
    });

    it("stores no logs", () => {
      PgCallHistory.add({
        programId: "P",
        cluster: "devnet",
        instruction: "increment",
        ok: false,
        signature: null,
        failingLine: "Error Code: X",
        logs: ["a", "b"],
      } as Parameters<typeof PgCallHistory.add>[0]);
      expect(localStorage.getItem(KEY)).not.toContain('"logs"');
    });

    it("tells listeners on subscribe and on every add", () => {
      const cb = vi.fn();
      const sub = PgCallHistory.onDidChange(cb);
      PgCallHistory.add(call("P", "devnet", "increment"));
      sub.dispose();
      PgCallHistory.add(call("P", "devnet", "increment"));
      expect(cb).toHaveBeenCalledTimes(2);
    });
  });
}
