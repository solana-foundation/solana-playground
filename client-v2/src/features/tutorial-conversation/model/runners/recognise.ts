import type { RunResult } from "../progress";

/** One signature that touched the program, newest first, as the RPC lists it */
export interface ProgramSignature {
  signature: string;
  slot: number;
  failed: boolean;
}

export interface RecogniseInput {
  act: "deploy" | "buildDeploy";
  programId: string | null;
  /** When the interrupted run started, by the device's clock, in ms */
  startedAtMs: number;
  /**
   * The slot of the program's last deploy or upgrade, from its ProgramData
   * account; null when the program is not on chain
   */
  deploySlot(programId: string): Promise<number | null>;
  /** A slot's time by the chain, in unix seconds; null when unknown */
  blockTime(slot: number): Promise<number | null>;
  /** The program's newest signatures, enough to reach the deploy's */
  signatures(programId: string): Promise<ProgramSignature[]>;
  instructions: string[];
}

/**
 * How far the device's clock may run ahead of the chain's and still own a
 * deploy: `startedAtMs` is the device's, a block time the chain's
 */
const CLOCK_SKEW_MS = 60_000;

/**
 * A deploy a reload interrupted, recognised from the chain. Only a deploy or
 * an upgrade moves the ProgramData account's deploy slot: an extend, a
 * buffer write or a call does not, so a newest signature alone could be any
 * of those. A deploy slot whose block came after the run started (within
 * `CLOCK_SKEW_MS`) is that run's; its signature is the one in that slot, and
 * a successful signature in an earlier slot means the program was already
 * there: an upgrade. The cost is not known (null).
 */
export const recogniseDeploy = async (
  input: RecogniseInput
): Promise<RunResult | null> => {
  if (!input.programId) return null;
  const slot = await input.deploySlot(input.programId);
  if (slot === null) return null;
  const time = await input.blockTime(slot);
  if (time === null || time * 1000 < input.startedAtMs - CLOCK_SKEW_MS) {
    return null;
  }
  const landed = (await input.signatures(input.programId)).filter(
    (s) => !s.failed
  );
  const deploy = landed.find((s) => s.slot === slot);
  if (!deploy) return null;
  return {
    act: input.act,
    ok: true,
    seconds: Math.max(0, time - input.startedAtMs / 1000),
    programId: input.programId,
    signature: deploy.signature,
    upgraded: landed.some((s) => s.slot < slot),
    lamports: null,
    instructions: input.instructions,
  };
};

export interface LandedInput {
  programId: string;
  /** Whether the deploy's buffer still exists: a deploy that lands consumes it */
  bufferExists(): Promise<boolean>;
  deploySlot(programId: string): Promise<number | null>;
  signatures(programId: string): Promise<ProgramSignature[]>;
}

/**
 * The signature of a deploy or upgrade whose confirm failed but which landed:
 * its buffer is gone and the program's deploy slot holds a successful
 * signature. Devnet confirms slowly, and a retry of a landed deploy fails on
 * the consumed buffer, so without this a live program reads as failed. Null
 * when it did not land, or the chain cannot place it yet.
 */
export const landedDeploy = async (
  input: LandedInput
): Promise<string | null> => {
  if (await input.bufferExists()) return null;
  const slot = await input.deploySlot(input.programId);
  if (slot === null) return null;
  const landed = (await input.signatures(input.programId)).find(
    (s) => !s.failed && s.slot === slot
  );
  return landed?.signature ?? null;
};

/**
 * The slot of a program's last deploy or upgrade, from its ProgramData
 * account's data: a u32 tag, then that slot as a u64. Null for data too
 * short to be one.
 */
export const deploySlotOf = (data: Uint8Array): number | null =>
  data.length < 12
    ? null
    : Number(
        new DataView(
          data.buffer,
          data.byteOffset,
          data.byteLength
        ).getBigUint64(4, true)
      );

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/tutorial-conversation/model/runners/recognise", () => {
    const PROGRAM = "Prog111111111111111111111111111111111111111";
    const STARTED = 1_700_000_000_000;
    const DEPLOY_SLOT = 500;

    /** A chain whose program was last deployed in `DEPLOY_SLOT`, at `secondsAfter` */
    const input = (
      signatures: ProgramSignature[],
      secondsAfter: number | null = 12,
      programId: string | null = PROGRAM,
      slot: number | null = DEPLOY_SLOT
    ): RecogniseInput => ({
      act: "deploy",
      programId,
      startedAtMs: STARTED,
      deploySlot: async () => slot,
      blockTime: async () =>
        secondsAfter === null ? null : STARTED / 1000 + secondsAfter,
      signatures: async () => signatures,
      instructions: ["hello"],
    });
    const sig = (signature: string, slot: number, failed = false) => ({
      signature,
      slot,
      failed,
    });

    it("recognises a first deploy that landed after the run started", async () => {
      await expect(
        recogniseDeploy(input([sig("deploySig", DEPLOY_SLOT)]))
      ).resolves.toEqual({
        act: "deploy",
        ok: true,
        seconds: 12,
        programId: PROGRAM,
        signature: "deploySig",
        upgraded: false,
        lamports: null,
        instructions: ["hello"],
      });
    });

    it("takes the deploy slot's signature, never a newer extend or call", async () => {
      await expect(
        recogniseDeploy(
          input([
            sig("callSig", DEPLOY_SLOT + 9),
            sig("upgradeSig", DEPLOY_SLOT),
            sig("extendSig", DEPLOY_SLOT - 3),
            sig("firstSig", 100),
          ])
        )
      ).resolves.toMatchObject({ signature: "upgradeSig", upgraded: true });
    });

    it("reads a failed earlier attempt as no upgrade", async () => {
      await expect(
        recogniseDeploy(
          input([sig("deploySig", DEPLOY_SLOT), sig("failedSig", 90, true)])
        )
      ).resolves.toMatchObject({ upgraded: false });
    });

    it("leaves a deploy from before the run alone, past the clock allowance", async () => {
      await expect(
        recogniseDeploy(input([sig("old", DEPLOY_SLOT)], -61))
      ).resolves.toBeNull();
      // A device clock a little ahead of the chain still owns its deploy
      await expect(
        recogniseDeploy(input([sig("mine", DEPLOY_SLOT)], -20))
      ).resolves.toMatchObject({ signature: "mine", seconds: 0 });
    });

    it("reads the deploy slot after ProgramData's tag", () => {
      const data = new Uint8Array(45);
      const view = new DataView(data.buffer);
      view.setUint32(0, 3, true);
      view.setBigUint64(4, BigInt(312_456_789), true);
      expect(deploySlotOf(data)).toBe(312_456_789);
      // A view into a larger buffer, as web3's account data can be
      const outer = new Uint8Array(64);
      outer.set(data, 7);
      expect(deploySlotOf(outer.subarray(7, 52))).toBe(312_456_789);
      expect(deploySlotOf(new Uint8Array(8))).toBeNull();
    });

    it("answers a deploy that landed though its confirm failed", async () => {
      const landed = (
        bufferExists: boolean,
        signatures: ProgramSignature[],
        slot: number | null = DEPLOY_SLOT
      ) =>
        landedDeploy({
          programId: PROGRAM,
          bufferExists: async () => bufferExists,
          deploySlot: async () => slot,
          signatures: async () => signatures,
        });
      await expect(
        landed(false, [
          sig("callSig", DEPLOY_SLOT + 2),
          sig("deploySig", DEPLOY_SLOT),
        ])
      ).resolves.toBe("deploySig");
      // The buffer still holds the program: the deploy did not land
      await expect(
        landed(true, [sig("deploySig", DEPLOY_SLOT)])
      ).resolves.toBeNull();
      // Not on chain, or the slot's signature failed or is not listed yet
      await expect(
        landed(false, [sig("deploySig", DEPLOY_SLOT)], null)
      ).resolves.toBeNull();
      await expect(
        landed(false, [sig("failedSig", DEPLOY_SLOT, true)])
      ).resolves.toBeNull();
      await expect(landed(false, [])).resolves.toBeNull();
    });

    it("leaves a program it cannot place alone", async () => {
      // Not on chain, no id, an unknown block time, no signature in the slot
      await expect(
        recogniseDeploy(input([], 12, PROGRAM, null))
      ).resolves.toBeNull();
      await expect(
        recogniseDeploy(input([sig("s", DEPLOY_SLOT)], 12, null))
      ).resolves.toBeNull();
      await expect(
        recogniseDeploy(input([sig("s", DEPLOY_SLOT)], null))
      ).resolves.toBeNull();
      await expect(
        recogniseDeploy(input([sig("other", DEPLOY_SLOT + 1)]))
      ).resolves.toBeNull();
    });
  });
}
