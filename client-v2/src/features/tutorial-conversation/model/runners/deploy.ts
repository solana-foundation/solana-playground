/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { shortKey } from "@/shared/lib/short-key";

import type { RunStage } from "../ports";
import type { RunResult } from "../progress";
import type { FundingChain } from "./fund";
import { fundForDeploy } from "./fund";

/** The stages' labels, as the act card shows them */
export const DEPLOY_STAGES = {
  funding: "Funding your wallet",
  building: "Building",
  buffer: "Writing buffer",
  deploying: "Deploying",
  confirming: "Confirming",
} as const;

/** Lamports kept for transaction fees on top of the rent a deploy locks */
const FEE_HEADROOM = 20_000_000;

/** What the deploy can learn about the program before it runs */
export interface ProgramState {
  /** The program id the workspace's keypair gives; null before any build */
  id: string | null;
  /** Whether the workspace holds the program's keypair, which a first deploy signs with */
  keypair: boolean;
  /** Whether a build must run first: none yet, or the last one failed */
  stale: boolean;
  /**
   * Bytes of the last build's binary, for the funding estimate; null when
   * unknown, which the real port always answers (only the server holds it)
   */
  length: number | null;
}

/** The program on chain: deployed means the next deploy is an upgrade */
export type OnChain =
  | { deployed: false }
  | {
      deployed: true;
      /** The program data account's length */
      dataLen: number;
      /** The upgrade authority; null when the program is immutable */
      authority: string | null;
    };

/**
 * Everything the deploy touches, so its order and its facts are tested with
 * no chain. The real one (`realDeployPort`) wraps the editor's loader calls.
 */
export interface DeployPort {
  /** Why the deploy cannot run here at all (a cluster other than devnet) */
  refusal(): string | null;
  /** The Playground wallet's address, or null when there is none */
  wallet(): string | null;
  /** Read twice, before and after the build, so it answers live */
  program(): ProgramState;
  /** Runs the build; a failure stops the deploy with its message */
  build(): Promise<{ ok: true } | { ok: false; message: string }>;
  /** The last build's binary */
  bytes(): Promise<Uint8Array>;
  /** Whether the program is on chain (an upgrade), its length and authority */
  onChain(id: string): Promise<OnChain>;
  /** Lamports a deploy of `length` bytes locks in rent, before fees */
  rent(length: number, onChain: OnChain): Promise<number>;
  funding: FundingChain;
  /** The cluster's faucet amount in whole SOL */
  capSol: number;
  /**
   * Extends the program data when an upgrade outgrows it, then creates the
   * buffer and writes the binary; returns the buffer address
   */
  writeBuffer(bytes: Uint8Array, onChain: OnChain): Promise<string>;
  /** First deploy from the buffer; returns the signature */
  deploy(buffer: string, length: number): Promise<string>;
  /** Upgrade from the buffer; returns the signature */
  upgrade(buffer: string): Promise<string>;
  /** Closes a buffer a failed deploy left, returning its rent to the wallet */
  closeBuffer(buffer: string): Promise<void>;
  /** Instruction names of the IDL the build produced */
  instructions(): string[];
  /** One line in the terminal */
  print(line: string): void;
  /** An unexpected throw, with the stage it stopped in, for the team */
  report(error: unknown, stage: string | null): void;
  now(): number;
}

/**
 * The binary length the funding estimate assumes when the last one is not
 * known: above a tutorial's Anchor program, so the one announced airdrop
 * covers the deploy and a second, unannounced one is rare
 */
const DEFAULT_LENGTH = 400_000;

const sol = (lamports: number) =>
  (lamports / 1_000_000_000).toFixed(lamports < 10_000_000 ? 4 : 2);

const failed = (
  act: "deploy" | "buildDeploy",
  started: number,
  now: number,
  reason: "failed" | "no_wallet",
  message: string
): RunResult => ({
  act,
  ok: false,
  seconds: (now - started) / 1000,
  reason,
  message,
});

/** Why the wallet cannot deploy this program, before any SOL is locked */
const blocker = (
  onChain: OnChain,
  program: ProgramState,
  address: string
): string | null => {
  if (!onChain.deployed) {
    return program.keypair
      ? null
      : "This workspace has only the program's id, not its keypair, so it cannot deploy it.";
  }
  if (onChain.authority === null) return "This program is not upgradable.";
  if (onChain.authority !== address) {
    return `This program's upgrade authority is ${shortKey(
      onChain.authority
    )}, not your wallet, so it cannot be upgraded from here.`;
  }
  return null;
};

/**
 * Deploys the workspace's program from the Playground wallet. Stages: Funding
 * your wallet (only when short), Building (only when stale or a
 * build-and-deploy), Writing buffer, Deploying, Confirming; "n of m" counts
 * what shows. A program on chain is upgraded in place, since the workspace
 * keeps its keypair. Every way it can stop is a result, never a throw: a
 * throw from the port is a failed deploy, and reported.
 */
export const runDeploy = async (
  port: DeployPort,
  act: "deploy" | "buildDeploy",
  onStage: (stage: RunStage) => void
): Promise<RunResult> => {
  const started = port.now();
  let current: string | null = null;
  try {
    const refusal = port.refusal();
    if (refusal) return failed(act, started, port.now(), "failed", refusal);
    const address = port.wallet();
    if (!address) {
      return failed(act, started, port.now(), "no_wallet", "No wallet");
    }

    const program = port.program();
    const stale = act === "buildDeploy" || program.stale;
    const estimateLength = program.length ?? DEFAULT_LENGTH;
    const before = await port.funding.balance(address);
    const knownOnChain: OnChain = program.id
      ? await port.onChain(program.id)
      : { deployed: false };
    const estimate =
      (await port.rent(estimateLength, knownOnChain)) + FEE_HEADROOM;
    const short = before < estimate;

    const labels: string[] = [];
    if (short) labels.push(DEPLOY_STAGES.funding);
    if (stale) labels.push(DEPLOY_STAGES.building);
    labels.push(
      DEPLOY_STAGES.buffer,
      DEPLOY_STAGES.deploying,
      DEPLOY_STAGES.confirming
    );
    let index = 0;
    const stage = (label: string) => {
      current = label;
      onStage({ label, index: ++index, count: labels.length });
    };

    const fund = async (need: number) => {
      const funded = await fundForDeploy({
        chain: port.funding,
        address,
        need,
        capSol: port.capSol,
        onShort: (amount) => port.print(`Airdropping ${amount} SOL...`),
      });
      if (funded.ok) return null;
      return {
        act,
        ok: false as const,
        seconds: (port.now() - started) / 1000,
        reason: "no_funds" as const,
        message: funded.message,
        balance: funded.balance,
        cost: need,
        address,
      };
    };

    if (short) {
      stage(DEPLOY_STAGES.funding);
      const refused = await fund(estimate);
      if (refused) return refused;
    }

    if (stale) {
      stage(DEPLOY_STAGES.building);
      const built = await port.build();
      if (!built.ok) {
        return failed(act, started, port.now(), "failed", built.message);
      }
    }

    const built = port.program();
    if (!built.id) {
      return failed(
        act,
        started,
        port.now(),
        "failed",
        "The build gave no program id"
      );
    }
    const id = built.id;
    const bytes = await port.bytes();
    const onChain = await port.onChain(id);
    const blocked = blocker(onChain, built, address);
    if (blocked) return failed(act, started, port.now(), "failed", blocked);
    const need = (await port.rent(bytes.length, onChain)) + FEE_HEADROOM;
    // The estimate ran on an assumed length; when the binary outgrew it, or
    // nothing was funded, the balance is checked against the real need
    // (`fundForDeploy` airdrops only when it is still short)
    if (need > estimate || !short) {
      const refused = await fund(need);
      if (refused) return refused;
    }
    stage(DEPLOY_STAGES.buffer);
    port.print(`Deploying from ${shortKey(address)} · about ${sol(need)} SOL`);
    const funded = await port.funding.balance(address);
    const buffer = await port.writeBuffer(bytes, onChain);

    stage(DEPLOY_STAGES.deploying);
    let signature: string;
    try {
      signature = onChain.deployed
        ? await port.upgrade(buffer)
        : await port.deploy(buffer, bytes.length);
    } catch (e) {
      // The buffer holds most of the deploy's SOL: give it back before the
      // failure stands, so a retry does not pay for a second one
      await port
        .closeBuffer(buffer)
        .catch((closing) => port.report(closing, "Closing the buffer"));
      throw e;
    }

    stage(DEPLOY_STAGES.confirming);
    const after = await port.funding.balance(address);
    return {
      act,
      ok: true,
      seconds: (port.now() - started) / 1000,
      programId: id,
      signature,
      upgraded: onChain.deployed,
      // An airdrop landing mid-deploy can make the difference negative
      lamports: Math.max(0, funded - after),
      instructions: port.instructions(),
    };
  } catch (e) {
    port.report(e, current);
    return failed(
      act,
      started,
      port.now(),
      "failed",
      e instanceof Error ? e.message : String(e)
    );
  }
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("features/tutorial-conversation/model/runners/deploy", () => {
    const SOL = 1_000_000_000;
    const WALLET = "Wa11et1111111111111111111111111111111111111";
    const PROGRAM = "Prog111111111111111111111111111111111111111";

    interface Fake {
      balances: number[];
      deployed: boolean;
      stale: boolean;
      id: string | null;
      airdrop?: FundingChain["airdrop"];
      build?: DeployPort["build"];
      deployThrows?: string;
      writeThrows?: string;
      /** The on-chain upgrade authority; the wallet when left out */
      authority?: string | null;
      keypair?: boolean;
      /** Bytes of the built binary; 120 000 when left out */
      built?: number;
    }

    /** A port over a scripted chain: balances are read in order, the last repeating */
    const portOf = (fake: Fake) => {
      const reads = fake.balances.slice();
      let id = fake.id;
      const lines: string[] = [];
      const port: DeployPort = {
        refusal: () => null,
        wallet: () => WALLET,
        program: () => ({
          id,
          keypair: fake.keypair ?? true,
          stale: fake.stale,
          length: 100_000,
        }),
        build: vi.fn(
          fake.build ??
            (async () => {
              id = PROGRAM;
              return { ok: true as const };
            })
        ),
        bytes: async () => new Uint8Array(fake.built ?? 120_000),
        onChain: async (): Promise<OnChain> =>
          fake.deployed
            ? {
                deployed: true,
                dataLen: 100_000,
                authority:
                  fake.authority === undefined ? WALLET : fake.authority,
              }
            : { deployed: false },
        rent: async (length) => length * 10_000,
        funding: {
          balance: vi.fn(
            async () =>
              (reads.length > 1 ? reads.shift() : undefined) ?? reads[0]
          ),
          airdrop: vi.fn(fake.airdrop ?? (async () => "airdropSig")),
          confirm: async () => true,
        },
        capSol: 5,
        writeBuffer: vi.fn(async () => {
          if (fake.writeThrows) throw new Error(fake.writeThrows);
          return "Buffer1111";
        }),
        deploy: vi.fn(async () => {
          if (fake.deployThrows) throw new Error(fake.deployThrows);
          return "deploySig";
        }),
        upgrade: vi.fn(async () => "upgradeSig"),
        closeBuffer: vi.fn(async () => {}),
        instructions: () => ["hello"],
        print: (line) => lines.push(line),
        report: vi.fn(),
        now: () => 1_000,
      };
      return { port, lines };
    };

    const collect = () => {
      const stages: RunStage[] = [];
      return { stages, onStage: (s: RunStage) => stages.push(s) };
    };

    it("stops before anything runs when there is no wallet", async () => {
      const { port } = portOf({
        balances: [0],
        deployed: false,
        stale: false,
        id: PROGRAM,
      });
      port.wallet = () => null;
      const { stages, onStage } = collect();
      await expect(runDeploy(port, "deploy", onStage)).resolves.toMatchObject({
        ok: false,
        reason: "no_wallet",
      });
      expect(stages).toEqual([]);
      expect(port.funding.balance).not.toHaveBeenCalled();
    });

    it("refuses off devnet before it reads the wallet", async () => {
      const { port } = portOf({
        balances: [0],
        deployed: false,
        stale: false,
        id: PROGRAM,
      });
      port.refusal = () => "Tutorials deploy to devnet.";
      await expect(runDeploy(port, "deploy", () => {})).resolves.toMatchObject({
        ok: false,
        reason: "failed",
        message: "Tutorials deploy to devnet.",
      });
      expect(port.funding.balance).not.toHaveBeenCalled();
    });

    it("funds an empty wallet as the first of five stages, then deploys", async () => {
      // first look, funding's look, after the airdrop, the post-build check,
      // before the buffer, after the deploy
      const { port, lines } = portOf({
        balances: [0, 0, 3 * SOL, 3 * SOL, 3 * SOL, 1.7 * SOL],
        deployed: false,
        stale: true,
        id: null,
      });
      const { stages, onStage } = collect();
      const result = await runDeploy(port, "deploy", onStage);
      expect(stages.map((s) => `${s.index}/${s.count} ${s.label}`)).toEqual([
        "1/5 Funding your wallet",
        "2/5 Building",
        "3/5 Writing buffer",
        "4/5 Deploying",
        "5/5 Confirming",
      ]);
      expect(result).toEqual({
        act: "deploy",
        ok: true,
        seconds: 0,
        programId: PROGRAM,
        signature: "deploySig",
        upgraded: false,
        lamports: 1.3 * SOL,
        instructions: ["hello"],
      });
      expect(port.deploy).toHaveBeenCalledWith("Buffer1111", 120_000);
      expect(lines[0]).toMatch(/^Airdropping \d+ SOL\.\.\.$/);
      expect(lines).toContain("Deploying from Wa11et…111111 · about 1.22 SOL");
    });

    it("upgrades a program on chain in place, with three stages when funded and built", async () => {
      const { port } = portOf({
        balances: [5 * SOL],
        deployed: true,
        stale: false,
        id: PROGRAM,
      });
      const { stages, onStage } = collect();
      const result = await runDeploy(port, "deploy", onStage);
      expect(stages.map((s) => s.label)).toEqual([
        "Writing buffer",
        "Deploying",
        "Confirming",
      ]);
      expect(stages.every((s) => s.count === 3)).toBe(true);
      expect(result).toMatchObject({
        ok: true,
        programId: PROGRAM,
        signature: "upgradeSig",
        upgraded: true,
      });
      expect(port.deploy).not.toHaveBeenCalled();
      // The port extends the program data from what is on chain
      expect(port.writeBuffer).toHaveBeenCalledWith(expect.any(Uint8Array), {
        deployed: true,
        dataLen: 100_000,
        authority: WALLET,
      });
    });

    it("builds first for a build-and-deploy even when the build is fresh", async () => {
      const { port } = portOf({
        balances: [5 * SOL],
        deployed: true,
        stale: false,
        id: PROGRAM,
      });
      const { stages, onStage } = collect();
      await runDeploy(port, "buildDeploy", onStage);
      expect(stages[0]).toEqual({ label: "Building", index: 1, count: 4 });
      expect(port.build).toHaveBeenCalledTimes(1);
    });

    it("answers a refused airdrop with no_funds, the balance, the cost and the address", async () => {
      const { port } = portOf({
        balances: [0.1 * SOL],
        deployed: false,
        stale: false,
        id: PROGRAM,
        airdrop: async () => {
          throw new Error("429 Too Many Requests");
        },
      });
      const { stages, onStage } = collect();
      await expect(runDeploy(port, "deploy", onStage)).resolves.toEqual({
        act: "deploy",
        ok: false,
        seconds: 0,
        reason: "no_funds",
        message: "429 Too Many Requests",
        balance: 0.1 * SOL,
        cost: 100_000 * 10_000 + FEE_HEADROOM,
        address: WALLET,
      });
      expect(stages.map((s) => s.label)).toEqual(["Funding your wallet"]);
      expect(port.writeBuffer).not.toHaveBeenCalled();
    });

    it("stops on a failed build with its message", async () => {
      const { port } = portOf({
        balances: [5 * SOL],
        deployed: false,
        stale: true,
        id: null,
        build: async () => ({ ok: false, message: "error[E0412]" }),
      });
      await expect(runDeploy(port, "deploy", () => {})).resolves.toMatchObject({
        ok: false,
        reason: "failed",
        message: "error[E0412]",
      });
      expect(port.writeBuffer).not.toHaveBeenCalled();
    });

    it("turns a throw from the chain into a failed deploy", async () => {
      const { port } = portOf({
        balances: [5 * SOL],
        deployed: false,
        stale: false,
        id: PROGRAM,
        deployThrows: "Exceeded maximum amount of retries",
      });
      await expect(runDeploy(port, "deploy", () => {})).resolves.toMatchObject({
        ok: false,
        reason: "failed",
        message: "Exceeded maximum amount of retries",
      });
    });

    it("funds again when the built binary outgrew the estimate, and stops when refused", async () => {
      // Covers the 400 000-byte estimate, not the 600 000-byte binary
      const { port } = portOf({
        balances: [4.1 * SOL],
        deployed: false,
        stale: false,
        id: PROGRAM,
        built: 600_000,
        airdrop: async () => {
          throw new Error("429 Too Many Requests");
        },
      });
      port.program = () => ({
        id: PROGRAM,
        keypair: true,
        stale: false,
        length: null,
      });
      await expect(runDeploy(port, "deploy", () => {})).resolves.toMatchObject({
        ok: false,
        reason: "no_funds",
        balance: 4.1 * SOL,
        cost: 600_000 * 10_000 + FEE_HEADROOM,
      });
      expect(port.writeBuffer).not.toHaveBeenCalled();
    });

    it("stops when the build leaves no program id", async () => {
      const { port } = portOf({
        balances: [5 * SOL],
        deployed: false,
        stale: true,
        id: null,
        build: async () => ({ ok: true }),
      });
      await expect(runDeploy(port, "deploy", () => {})).resolves.toMatchObject({
        ok: false,
        reason: "failed",
        message: "The build gave no program id",
      });
      expect(port.writeBuffer).not.toHaveBeenCalled();
    });

    it("refuses before any SOL is locked when another wallet holds the upgrade authority", async () => {
      const { port } = portOf({
        balances: [5 * SOL],
        deployed: true,
        stale: false,
        id: PROGRAM,
        authority: "Other11111111111111111111111111111111111111",
      });
      await expect(runDeploy(port, "deploy", () => {})).resolves.toMatchObject({
        ok: false,
        reason: "failed",
        message: expect.stringMatching(/upgrade authority is Other1…111111/),
      });
      expect(port.writeBuffer).not.toHaveBeenCalled();
    });

    it("refuses an immutable program, and a first deploy without the keypair", async () => {
      const immutable = portOf({
        balances: [5 * SOL],
        deployed: true,
        stale: false,
        id: PROGRAM,
        authority: null,
      }).port;
      await expect(
        runDeploy(immutable, "deploy", () => {})
      ).resolves.toMatchObject({ message: "This program is not upgradable." });
      const idOnly = portOf({
        balances: [5 * SOL],
        deployed: false,
        stale: false,
        id: PROGRAM,
        keypair: false,
      }).port;
      await expect(
        runDeploy(idOnly, "deploy", () => {})
      ).resolves.toMatchObject({
        ok: false,
        message: expect.stringMatching(/not its keypair/),
      });
      expect(idOnly.writeBuffer).not.toHaveBeenCalled();
    });

    it("closes the buffer when the deploy fails after writing it", async () => {
      const { port } = portOf({
        balances: [5 * SOL],
        deployed: false,
        stale: false,
        id: PROGRAM,
        deployThrows: "Exceeded maximum amount of retries",
      });
      await expect(runDeploy(port, "deploy", () => {})).resolves.toMatchObject({
        ok: false,
        reason: "failed",
      });
      expect(port.closeBuffer).toHaveBeenCalledWith("Buffer1111");
      expect(port.report).toHaveBeenCalledWith(expect.any(Error), "Deploying");
    });

    it("reports a throw with the stage it stopped in", async () => {
      const { port } = portOf({
        balances: [5 * SOL],
        deployed: false,
        stale: false,
        id: PROGRAM,
        writeThrows: "Blockhash not found",
      });
      await expect(runDeploy(port, "deploy", () => {})).resolves.toMatchObject({
        ok: false,
        reason: "failed",
        message: "Blockhash not found",
      });
      expect(port.report).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Blockhash not found" }),
        "Writing buffer"
      );
    });
  });
}
