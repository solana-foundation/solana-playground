import type {
  CustomRpc,
  Refused,
  RpcHealth,
  SaveResult,
} from "@/entities/custom-rpc";
import { PgCustomRpcs } from "@/entities/custom-rpc";
import { createLogger } from "@/shared/lib/logger";

import { settingsTelemetry } from "./telemetry";

const log = createLogger("settings-page:save-custom-rpc");

/** Why a URL went unchecked: no answer in time, or no request because offline */
type Unchecked = Exclude<RpcHealth, "answered">;

/**
 * A write refused because a running deploy holds the network on the RPC
 * being edited: a new URL for it would move the connection, which a deploy
 * must not see
 */
type Held = { ok: false; reason: "held" };

const HELD: Held = Object.freeze({ ok: false, reason: "held" });

/** What a write answers: the list's result, or held by a deploy */
export type WriteResult = SaveResult | Held;

/** A save's last word: saved, or the line to show under the URL */
export type SettledAnswer =
  | { kind: "saved" }
  | { kind: "refused"; error: string };

/**
 * What saving answers the form: settled, or, for a URL that could not be
 * checked, the line with "Use anyway", which saves without the check
 */
export type CustomRpcSaveAnswer =
  | SettledAnswer
  | { kind: "unreachable"; error: string; useAnyway: () => SettledAnswer };

/** How a save went once its URL was checked, or why it waits on the person */
export type CheckedSave =
  | {
      kind: "saved";
      rpc: CustomRpc;
      /** `none`: an edit that kept its URL, so no request was sent */
      check: "passed" | "none";
    }
  | { kind: "refused"; refusal: Refused | Held }
  | {
      kind: "unreachable";
      reason: Unchecked;
      /** Save without the check: "Use anyway" */
      useAnyway: () => WriteResult;
    };

/** A write's result as a checked save, under how its URL was checked */
const writtenWith =
  (check: "passed" | "none") =>
  (result: WriteResult): CheckedSave =>
    result.ok
      ? { kind: "saved", rpc: result.rpc, check }
      : { kind: "refused", refusal: result };

/**
 * Save `input` (over the saved RPC `replacing`, or as a new one) once
 * its URL answers `fetchHealth`. A value the list would refuse sends no
 * request, and neither does an edit that keeps its URL or one `isHeld`
 * refuses. The write checks the list again, since another tab may change it
 * during the wait.
 *
 * `isHeld` answers, for the URL an RPC is saved under, whether a deploy
 * holds the network on that RPC now. An edit that changes its URL asks it
 * after the list's own checks, before the request, and again at the write,
 * since a deploy may start during the wait or before "Use anyway"; a rename
 * and a new RPC never ask.
 */
export const saveCheckedWith =
  (fetchHealth: (url: string) => Promise<RpcHealth>) =>
  (isHeld: (url: string) => boolean) =>
  async (
    input: CustomRpc,
    replacing: CustomRpc | undefined
  ): Promise<CheckedSave> => {
    const checked = PgCustomRpcs.check(input, replacing);
    if (!checked.ok) return { kind: "refused", refusal: checked };
    let write: () => WriteResult = () => PgCustomRpcs.save(input);
    if (replacing !== undefined) {
      const edit = () => PgCustomRpcs.replace(replacing, input);
      if (checked.url === replacing.url) return writtenWith("none")(edit());
      if (isHeld(replacing.url)) return { kind: "refused", refusal: HELD };
      write = () => (isHeld(replacing.url) ? HELD : edit());
    }
    const health = await fetchHealth(checked.url);
    if (health === "answered") return writtenWith("passed")(write());
    return { kind: "unreachable", reason: health, useAnyway: write };
  };

/** The line under the URL field for a refused save (the `client-v2-custom-rpcs` spec's copy) */
const refusalLine = (result: Refused | Held): string => {
  switch (result.reason) {
    case "held":
      return "A deploy is running. Change the URL when it ends.";
    case "format":
      return "Enter a URL that starts with https://, or http:// for a local validator.";
    case "duplicate":
      return `Already saved as ${result.name}.`;
    case "storage":
      return "Could not save in this browser.";
  }
};

/** The line for a URL that could not be checked; "not responding" is the app's word */
const UNCHECKED: Record<Unchecked, string> = {
  no_answer: "This URL is not responding.",
  offline: "You're offline, so this URL can't be checked.",
};

type SaveMode = "add" | "edit";

/**
 * Track a refusal and answer its line. A hold is not tracked: the event's
 * reasons describe input the list refused, and a hold is not one of them
 */
const refuse = (result: Refused | Held): SettledAnswer => {
  if (result.reason !== "held") {
    settingsTelemetry.track("settings_custom_rpc_refused", {
      reason: result.reason,
    });
  }
  return { kind: "refused", error: refusalLine(result) };
};

/**
 * Track a save, run `onSaved`, and answer it. The RPC is in the list by
 * then, so an `onSaved` that throws (moving the connection onto it) is
 * reported, and the form still says it saved: "Could not save" would be
 * wrong about a listed RPC, which its chip picks again.
 */
const keepWith =
  (onSaved: (rpc: CustomRpc) => void) =>
  (mode: SaveMode) =>
  (check: "passed" | "used_anyway" | "none") =>
  (rpc: CustomRpc): SettledAnswer => {
    settingsTelemetry.track("settings_custom_rpc_saved", { mode, check });
    try {
      onSaved(rpc);
    } catch (e) {
      log.error(e, { report: true });
    }
    return { kind: "saved" };
  };

/**
 * Turn a checked save into the form's answer, tracking each outcome:
 * a refusal is the line under the field, an unchecked URL the line with
 * "Use anyway", and a save calls `onSaved` with the stored RPC
 */
export const answerFor =
  (onSaved: (rpc: CustomRpc) => void) =>
  (mode: SaveMode) =>
  (checked: CheckedSave): CustomRpcSaveAnswer => {
    const keep = keepWith(onSaved)(mode);
    switch (checked.kind) {
      case "saved":
        return keep(checked.check)(checked.rpc);
      case "refused":
        return refuse(checked.refusal);
      case "unreachable":
        settingsTelemetry.track("settings_custom_rpc_refused", {
          reason: checked.reason,
        });
        return {
          kind: "unreachable",
          error: UNCHECKED[checked.reason],
          useAnyway: () => {
            const result = checked.useAnyway();
            return result.ok ? keep("used_anyway")(result.rpc) : refuse(result);
          },
        };
    }
  };

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach, afterEach, beforeAll } =
    import.meta.vitest;

  describe("widgets/settings-page/model/save-custom-rpc", () => {
    let telemetry: typeof import("@/shared/lib/telemetry");
    let events: ReturnType<typeof telemetry.memoryProvider>;
    beforeAll(async () => {
      telemetry = await import("@/shared/lib/telemetry");
    });
    beforeEach(() => {
      localStorage.clear();
      events = telemetry.memoryProvider();
      telemetry.initTelemetry({ providers: [events] });
    });
    afterEach(() => {
      telemetry.resetTelemetry();
    });

    const tracked = () => events.events.map((e) => [e.name, e.params]);
    const healthOf = (health: RpcHealth) => vi.fn(async () => health);
    const neverHeld = () => false;
    const saveCheckedWithout = (fetchHealth: () => Promise<RpcHealth>) =>
      saveCheckedWith(fetchHealth)(neverHeld);
    const TRITON = { name: "Triton", url: "https://t.test" };
    const SAVED_TRITON = { name: "Triton", url: "https://t.test/" };

    describe("saveCheckedWith", () => {
      it("saves a URL that answers, after one check of its normalised URL", async () => {
        const health = healthOf("answered");
        const checked = await saveCheckedWith(health)(neverHeld)(
          TRITON,
          undefined
        );
        expect(health).toHaveBeenCalledWith("https://t.test/");
        expect(checked).toEqual({
          kind: "saved",
          rpc: SAVED_TRITON,
          check: "passed",
        });
        expect(PgCustomRpcs.list()).toHaveLength(1);
      });

      it.each(["no_answer", "offline"] as const)(
        "saves nothing on %s until Use anyway",
        async (reason) => {
          const checked = await saveCheckedWithout(healthOf(reason))(
            TRITON,
            undefined
          );
          if (checked.kind !== "unreachable") throw new Error(checked.kind);
          expect(checked.reason).toBe(reason);
          expect(PgCustomRpcs.list()).toEqual([]);
          expect(checked.useAnyway().ok).toBe(true);
          expect(PgCustomRpcs.list()).toEqual([SAVED_TRITON]);
        }
      );

      it("sends no request for a value the list refuses", async () => {
        const health = healthOf("answered");
        const checked = await saveCheckedWith(health)(neverHeld)(
          { name: "", url: "devnet" },
          undefined
        );
        expect(health).not.toHaveBeenCalled();
        expect(checked).toEqual({
          kind: "refused",
          refusal: { ok: false, reason: "format" },
        });
      });

      it("sends no request for an edit that keeps its URL", async () => {
        PgCustomRpcs.save(TRITON);
        const health = healthOf("no_answer");
        const checked = await saveCheckedWith(health)(neverHeld)(
          { name: "Triton 2", url: "https://T.test" },
          SAVED_TRITON
        );
        expect(health).not.toHaveBeenCalled();
        expect(checked).toMatchObject({ kind: "saved", check: "none" });
        expect(PgCustomRpcs.list()[0].name).toBe("Triton 2");
      });

      it("checks an edit that changes its URL, and replaces in place", async () => {
        PgCustomRpcs.save(TRITON);
        const health = healthOf("answered");
        await saveCheckedWith(health)(neverHeld)(
          { name: "Triton", url: "https://t2.test" },
          SAVED_TRITON
        );
        expect(health).toHaveBeenCalledWith("https://t2.test/");
        expect(PgCustomRpcs.list()).toEqual([
          { name: "Triton", url: "https://t2.test/" },
        ]);
      });

      it("refuses an entry another tab saved while it was being checked", async () => {
        const health = vi.fn(async () => {
          PgCustomRpcs.save(TRITON);
          return "answered" as const;
        });
        const checked = await saveCheckedWith(health)(neverHeld)(
          TRITON,
          undefined
        );
        expect(checked).toEqual({
          kind: "refused",
          refusal: { ok: false, reason: "duplicate", name: "Triton" },
        });
      });

      describe("while the RPC being edited is held", () => {
        const T2 = { name: "Triton", url: "https://t2.test" };

        it("refuses a new URL before any request, asking about the URL it replaces", async () => {
          PgCustomRpcs.save(TRITON);
          const health = healthOf("answered");
          const isHeld = vi.fn((url: string) => url === "https://t.test/");
          const checked = await saveCheckedWith(health)(isHeld)(
            T2,
            SAVED_TRITON
          );
          expect(health).not.toHaveBeenCalled();
          expect(isHeld).toHaveBeenCalledWith("https://t.test/");
          expect(checked).toEqual({
            kind: "refused",
            refusal: { ok: false, reason: "held" },
          });
          expect(PgCustomRpcs.list()).toEqual([SAVED_TRITON]);
        });

        it("refuses a new URL when the hold starts during the request", async () => {
          PgCustomRpcs.save(TRITON);
          let held = false;
          const health = vi.fn(async () => {
            held = true;
            return "answered" as const;
          });
          const checked = await saveCheckedWith(health)(() => held)(
            T2,
            SAVED_TRITON
          );
          expect(checked).toEqual({ kind: "refused", refusal: HELD });
          expect(PgCustomRpcs.list()).toEqual([SAVED_TRITON]);
        });

        it("refuses Use anyway once the hold has started", async () => {
          PgCustomRpcs.save(TRITON);
          let held = false;
          const checked = await saveCheckedWith(healthOf("no_answer"))(
            () => held
          )(T2, SAVED_TRITON);
          if (checked.kind !== "unreachable") throw new Error(checked.kind);
          held = true;
          expect(checked.useAnyway()).toEqual(HELD);
          expect(PgCustomRpcs.list()).toEqual([SAVED_TRITON]);
        });

        it("saves a rename, though spelt differently, which keeps the URL", async () => {
          PgCustomRpcs.save(TRITON);
          const checked = await saveCheckedWith(healthOf("answered"))(
            () => true
          )({ name: "Mine", url: "https://T.test" }, SAVED_TRITON);
          expect(checked).toMatchObject({ kind: "saved", check: "none" });
        });

        it("saves a new URL through Use anyway while nothing holds it", async () => {
          PgCustomRpcs.save(TRITON);
          const checked = await saveCheckedWith(healthOf("no_answer"))(
            () => false
          )(T2, SAVED_TRITON);
          if (checked.kind !== "unreachable") throw new Error(checked.kind);
          expect(checked.useAnyway().ok).toBe(true);
          expect(PgCustomRpcs.list()).toEqual([
            { name: "Triton", url: "https://t2.test/" },
          ]);
        });

        it("does not ask about a new RPC", async () => {
          const isHeld = vi.fn(() => true);
          const checked = await saveCheckedWith(healthOf("answered"))(isHeld)(
            TRITON,
            undefined
          );
          expect(isHeld).not.toHaveBeenCalled();
          expect(checked).toMatchObject({ kind: "saved" });
        });
      });

      describe("when the browser refuses the write", () => {
        beforeEach(() => {
          vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new DOMException("full", "QuotaExceededError");
          });
        });
        afterEach(() => {
          vi.restoreAllMocks();
        });

        it("refuses a URL that answered", async () => {
          expect(
            await saveCheckedWithout(healthOf("answered"))(TRITON, undefined)
          ).toEqual({
            kind: "refused",
            refusal: { ok: false, reason: "storage" },
          });
        });

        it("refuses through Use anyway", async () => {
          const checked = await saveCheckedWithout(healthOf("no_answer"))(
            TRITON,
            undefined
          );
          if (checked.kind !== "unreachable") throw new Error(checked.kind);
          expect(checked.useAnyway()).toEqual({ ok: false, reason: "storage" });
        });
      });

      it("refuses Use anyway for an entry another tab saved meanwhile", async () => {
        const checked = await saveCheckedWithout(healthOf("no_answer"))(
          TRITON,
          undefined
        );
        if (checked.kind !== "unreachable") throw new Error(checked.kind);
        PgCustomRpcs.save(TRITON);
        expect(checked.useAnyway()).toEqual({
          ok: false,
          reason: "duplicate",
          name: "Triton",
        });
        expect(PgCustomRpcs.list()).toHaveLength(1);
      });
    });

    describe("answerFor", () => {
      it("answers saved and reports it when onSaved throws after the list write", async () => {
        const logger = await import("@/shared/lib/logger");
        const logged = logger.memoryProvider();
        logger.initLogger({ providers: [logged] });
        try {
          const answer = answerFor(() => {
            throw new Error("settings write refused");
          })("add")({ kind: "saved", rpc: SAVED_TRITON, check: "passed" });
          expect(answer).toEqual({ kind: "saved" });
          expect(
            logged.entries.map(({ error, report }) => [error?.message, report])
          ).toEqual([["settings write refused", true]]);
        } finally {
          logger.resetLogger();
        }
      });

      it("tracks a checked save with check passed and calls onSaved", () => {
        const onSaved = vi.fn();
        const answer = answerFor(onSaved)("add")({
          kind: "saved",
          rpc: SAVED_TRITON,
          check: "passed",
        });
        expect(answer).toEqual({ kind: "saved" });
        expect(onSaved).toHaveBeenCalledWith(SAVED_TRITON);
        expect(tracked()).toEqual([
          ["settings_custom_rpc_saved", { mode: "add", check: "passed" }],
        ]);
      });

      it("answers a refusal with the spec's line", () => {
        const answer = answerFor(vi.fn())("edit")({
          kind: "refused",
          refusal: { ok: false, reason: "duplicate", name: "Helius" },
        });
        expect(answer).toEqual({
          kind: "refused",
          error: "Already saved as Helius.",
        });
        expect(tracked()).toEqual([
          ["settings_custom_rpc_refused", { reason: "duplicate" }],
        ]);
      });

      it.each([
        ["no_answer", "This URL is not responding."],
        ["offline", "You're offline, so this URL can't be checked."],
      ] as const)(
        "offers Use anyway on %s, and tracks it apart",
        (reason, line) => {
          const onSaved = vi.fn();
          const answer = answerFor(onSaved)("add")({
            kind: "unreachable",
            reason,
            useAnyway: () => ({ ok: true, rpc: SAVED_TRITON }),
          });
          if (answer.kind !== "unreachable") throw new Error(answer.kind);
          expect(answer.error).toBe(line);
          expect(onSaved).not.toHaveBeenCalled();
          expect(answer.useAnyway()).toEqual({ kind: "saved" });
          expect(onSaved).toHaveBeenCalledWith(SAVED_TRITON);
          expect(tracked()).toEqual([
            ["settings_custom_rpc_refused", { reason }],
            [
              "settings_custom_rpc_saved",
              { mode: "add", check: "used_anyway" },
            ],
          ]);
        }
      );

      it("tracks an edit that kept its URL with check none", () => {
        answerFor(vi.fn())("edit")({
          kind: "saved",
          rpc: SAVED_TRITON,
          check: "none",
        });
        expect(tracked()).toEqual([
          ["settings_custom_rpc_saved", { mode: "edit", check: "none" }],
        ]);
      });

      it("answers and tracks a Use anyway the list refuses", () => {
        const onSaved = vi.fn();
        const answer = answerFor(onSaved)("add")({
          kind: "unreachable",
          reason: "no_answer",
          useAnyway: () => ({ ok: false, reason: "duplicate", name: "B" }),
        });
        if (answer.kind !== "unreachable") throw new Error(answer.kind);
        expect(answer.useAnyway()).toEqual({
          kind: "refused",
          error: "Already saved as B.",
        });
        expect(onSaved).not.toHaveBeenCalled();
        expect(tracked()).toEqual([
          ["settings_custom_rpc_refused", { reason: "no_answer" }],
          ["settings_custom_rpc_refused", { reason: "duplicate" }],
        ]);
      });

      it("answers a hold at Use anyway with its line, and tracks only the unchecked URL", () => {
        const onSaved = vi.fn();
        const answer = answerFor(onSaved)("edit")({
          kind: "unreachable",
          reason: "no_answer",
          useAnyway: () => HELD,
        });
        if (answer.kind !== "unreachable") throw new Error(answer.kind);
        expect(answer.useAnyway()).toEqual({
          kind: "refused",
          error: "A deploy is running. Change the URL when it ends.",
        });
        expect(onSaved).not.toHaveBeenCalled();
        expect(tracked()).toEqual([
          ["settings_custom_rpc_refused", { reason: "no_answer" }],
        ]);
      });

      it("answers a hold with its line, and tracks nothing", () => {
        const answer = answerFor(vi.fn())("edit")({
          kind: "refused",
          refusal: HELD,
        });
        expect(answer).toEqual({
          kind: "refused",
          error: "A deploy is running. Change the URL when it ends.",
        });
        expect(tracked()).toEqual([]);
      });
    });
  });
}
