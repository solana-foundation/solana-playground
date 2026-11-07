/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ActBeat,
  Ask,
  Follow,
  TutorialDefinition,
} from "@/entities/tutorial";
import type {
  ApplyFailure,
  LandedCall,
  Proposal,
  RunResult,
  Turn,
} from "@/features/tutorial-conversation";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { requireFor } from "@/test-utils/require-for";

import hello from "../../../tutorials/hello-anchor/tutorial.json";
import lumberjack from "../../../tutorials/lumberjack/tutorial.json";
import BaseActCard from "./BaseActCard";
import BaseApplyCard from "./BaseApplyCard";
import BaseFinishCard from "./BaseFinishCard";
import BaseIntroCard, { HOW_IT_GOES, INTRO_NOTE } from "./BaseIntroCard";
import { BaseQuestionRecord } from "./BaseQuestionCard";
import BaseResultCard from "./BaseResultCard";
import BaseStepDivider from "./BaseStepDivider";
import BaseWinCard from "./BaseWinCard";
import BaseWroteCard from "./BaseWroteCard";
import { textOf } from "./Prose";
import type { TurnHandlers } from "./TurnView";
import TurnView from "./TurnView";

const definition = hello as unknown as TutorialDefinition;
const actOf = (id: string) =>
  requireFor(`the act ${id}`)(
    definition.steps
      .flatMap((s) => s.beats)
      .find((b): b is ActBeat => b.kind === "act" && b.id === id)
  );
const build = () => actOf("s1.build");
const call = () => actOf("s4.call");

describe("BaseIntroCard", () => {
  const intro = (onStart = vi.fn()) =>
    render(
      <BaseIntroCard
        name={definition.name}
        thumbnail={definition.thumbnail}
        minutes={definition.minutes}
        stepCount={definition.steps.length}
        promise={definition.intro.promise}
        log={definition.intro.log}
        onStart={onStart}
      />
    );

  it("says what you build, how it goes, and offers one Start", () => {
    intro();
    expect(screen.getByRole("heading", { name: "Hello Anchor" })).toBeTruthy();
    expect(screen.getByText("10 min · 4 steps")).toBeTruthy();
    expect(screen.getByText(INTRO_NOTE)).toBeTruthy();
    expect(screen.getByText("What you'll build")).toBeTruthy();
    expect(screen.getByText(definition.intro.log)).toBeTruthy();
    expect(screen.getByText(HOW_IT_GOES)).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Start step 1/ })).toBeTruthy();
  });

  it("starts on the button, and on Enter while nothing has focus", async () => {
    const onStart = vi.fn();
    intro(onStart);
    await userEvent.click(screen.getByRole("button", { name: /Start step 1/ }));
    expect(onStart).toHaveBeenCalledTimes(1);

    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("leaves Enter to a field that has focus", () => {
    const onStart = vi.fn();
    intro(onStart);
    const field = document.createElement("textarea");
    document.body.appendChild(field);
    field.focus();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onStart).not.toHaveBeenCalled();
    field.remove();
  });
});

describe("BaseStepDivider", () => {
  it("heads the step with its objective alone, before and after it passes", () => {
    render(
      <BaseStepDivider objective="Define the hello instruction and log a message" />
    );
    expect(
      screen.getByRole("heading", {
        name: "Define the hello instruction and log a message",
      })
    ).toBeTruthy();
    expect(screen.queryByText(/Step \d of/)).toBeNull();
    expect(screen.queryByLabelText("Passed")).toBeNull();
  });
});

describe("BaseWroteCard", () => {
  const lines = [5, 6, 7, 8, 9, 10, 11, 12, 13];

  it("keeps a blank written line's row, so the numbers stay beside their code", () => {
    render(
      <BaseWroteCard
        wrote={{ file: "src/lib.rs", lines: [1, 2, 3] }}
        failed={false}
        preview={["use x;", "", "fn f() {}"]}
        onShow={vi.fn()}
      />
    );
    const card = screen.getByRole("button", {
      name: "Show lines 1 to 3 in src/lib.rs",
    });
    const rows = Array.from(card.querySelectorAll("span.whitespace-pre"));
    expect(rows).toHaveLength(3);
    expect(rows[1].className).toContain("min-h-5");
  });

  it("is a button naming the lines, headed by the path alone, with the first three and '⋯ N more lines'", async () => {
    const onShow = vi.fn();
    render(
      <BaseWroteCard
        wrote={{ file: "src/lib.rs", lines }}
        failed={false}
        preview={["#[program]", "mod hello_anchor {", "    use super::*;"]}
        onShow={onShow}
      />
    );
    const card = screen.getByRole("button", {
      name: "Show lines 5 to 13 in src/lib.rs",
    });
    expect(card.textContent?.startsWith("src/lib.rs5")).toBe(true);
    expect(card.textContent).not.toContain("lines 5 to 13");
    expect(card.textContent).not.toContain("+9");
    expect(card.textContent).not.toContain("Show in");
    expect(card.textContent).toContain("#[program]");
    expect(card.textContent).toContain("⋯6 more lines");
    await userEvent.click(card);
    expect(onShow).toHaveBeenCalledWith("src/lib.rs", 5);
  });

  it("names one line as a line", () => {
    render(
      <BaseWroteCard
        wrote={{ file: "src/lib.rs", lines: [9] }}
        failed={false}
        preview={["msg!(x);"]}
        onShow={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: "Show line 9 in src/lib.rs" })
    ).toBeTruthy();
  });

  it("reads Created with New file for a file the write made", () => {
    render(
      <BaseWroteCard
        wrote={{ file: "client/client.ts", lines: [1, 2], created: true }}
        failed={false}
        preview={[]}
        onShow={vi.fn()}
      />
    );
    expect(screen.getByText("Created client/client.ts")).toBeTruthy();
    expect(screen.getByText("New file")).toBeTruthy();
  });

  it("says a block it put at the end keeps the learner's lines, and offers Reset", async () => {
    const onReset = vi.fn();
    render(
      <BaseWroteCard
        wrote={{ file: "src/lib.rs", lines: [9, 10], appended: true }}
        failed={false}
        preview={["#[program]", "mod hello_anchor {"]}
        onShow={vi.fn()}
        onReset={onReset}
      />
    );
    expect(
      screen.getByText("I put it at the end: your own lines are kept.")
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Reset lib.rs to this step's start" })
    );
    // Asked first: nothing restarts until the dialog's Reset
    expect(onReset).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: "Reset lib.rs to this step's start?",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Reset" })
    );
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show lines 9 to 10 in src/lib.rs" })
    ).toBeTruthy();
  });

  it("restarts nothing when the Reset is cancelled", async () => {
    const onReset = vi.fn();
    render(
      <BaseWroteCard
        wrote={{ file: "src/lib.rs", lines: [9], appended: true }}
        failed={false}
        preview={["x"]}
        onShow={vi.fn()}
        onReset={onReset}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /^Reset lib/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the note but offers no Reset once its step is a record", () => {
    render(
      <BaseWroteCard
        wrote={{ file: "src/lib.rs", lines: [9], appended: true }}
        failed={false}
        preview={["x"]}
        onShow={vi.fn()}
      />
    );
    expect(screen.getByText(/I put it at the end/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
  });

  it("says the block is not in the file when the write failed", () => {
    render(<BaseWroteCard wrote={null} failed preview={[]} onShow={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain(
      "not in your file"
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("BaseActCard", () => {
  const card = (over: Partial<Parameters<typeof BaseActCard>[0]> = {}) =>
    render(
      <BaseActCard
        act={over.act ?? build()}
        state={over.state ?? "live"}
        presses={over.presses ?? []}
        note={over.note ?? null}
        stage={over.stage ?? null}
        took={over.took ?? null}
        disabled={over.disabled ?? false}
        onRun={over.onRun ?? vi.fn()}
      />
    );

  it("offers its button with ⌘↵ while live", async () => {
    const onRun = vi.fn();
    card({ onRun });
    expect(screen.getByText("Build lib.rs")).toBeTruthy();
    expect(
      screen.getByText("Compiles lib.rs on Playground's build server")
    ).toBeTruthy();
    const button = screen.getByRole("button", { name: /Build/ });
    expect(button.textContent).toContain("⌘↵");
    await userEvent.click(button);
    expect(onRun).toHaveBeenCalledWith(undefined);
  });

  it("gives the button way to the stage, n of m and a bar while it runs", () => {
    card({
      state: "running",
      stage: { beatId: "s1.build", label: "Building", index: 1, count: 2 },
    });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Building")).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(screen.getByTestId("act-stage-bar").style.transform).toBe(
      "scaleX(0.5)"
    );
  });

  it("shows how far a long stage has got beside n of m", () => {
    card({
      state: "running",
      stage: {
        beatId: "s1.deploy",
        label: "Writing buffer",
        index: 1,
        count: 3,
        detail: "40 of 200 transactions",
      },
    });
    expect(screen.getByText("· 40 of 200 transactions")).toBeTruthy();
  });

  it("waits while another act runs", () => {
    card({ disabled: true });
    expect(
      (screen.getByRole("button", { name: /Build/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("asks for each argument of a call, up to 32 characters, and Enter sends", async () => {
    const onRun = vi.fn();
    card({ act: call(), onRun });
    const send = screen.getByRole("button", { name: /Call hello/ });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Type any name")).toBeTruthy();

    const field = screen.getByRole("textbox", { name: "name" });
    expect(field.getAttribute("maxlength")).toBe("32");
    await userEvent.type(field, "Alex{Enter}");
    expect(onRun).toHaveBeenCalledWith({ name: "Alex" });
  });

  it("reads the interrupted line after a reload cut its run", () => {
    card({
      state: "interrupted",
      note: "Interrupted by a reload. Run it again.",
    });
    expect(
      screen.getByText("Interrupted by a reload. Run it again.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Build/ })).toBeTruthy();
  });

  it("becomes one line with no button once it ran", () => {
    card({ state: "done", took: 1600 });
    expect(screen.getByText("Built in 1.6 s")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  /** A call on `paint` with one argument to fill and one the definition gives */
  const paint = (): ActBeat => ({
    kind: "act",
    id: "s1.paint",
    title: "Paint a pixel",
    context: "Sends paint to your program",
    button: "Paint",
    act: "call",
    call: {
      instruction: "paint",
      args: ["name", { name: "at", value: 35000 }],
    },
  });

  it("asks only for the arguments the definition gives no value", async () => {
    const onRun = vi.fn();
    card({ act: paint(), onRun });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    await userEvent.type(
      screen.getByRole("textbox", { name: "name" }),
      "Alex{Enter}"
    );
    expect(onRun).toHaveBeenCalledWith({ name: "Alex" });
  });

  it("reads the act's own record line before its time", () => {
    card({
      act: {
        kind: "act",
        id: "s1.init",
        title: "Create your map",
        context: "Calls init_map",
        button: "Create",
        record: "Created your map · 10 KB",
        act: "build",
      },
      state: "done",
      took: 900,
    });
    expect(screen.getByText("Created your map · 10 KB · 0.9 s")).toBeTruthy();
  });

  it("reads a refusal that passed the step as refused, with no button", () => {
    card({ act: paint(), state: "refused", took: 900 });
    expect(screen.getByText("Paint a pixel refused in 0.9 s")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("BaseResultCard", () => {
  /** The card for a run's or a call's result, with no failure open */
  const txCard = (
    result: RunResult,
    {
      open = false,
      onRecheck = vi.fn(),
      exists,
    }: { open?: boolean; onRecheck?: () => void; exists?: string } = {}
  ) =>
    render(
      // The app's root provides the tooltip Copy signature carries
      <TooltipProvider>
        <BaseResultCard
          result={result}
          exists={exists}
          planned={null}
          open={open}
          onExplain={vi.fn()}
          onFixMyself={vi.fn()}
          onShowLine={vi.fn()}
          onRetry={vi.fn()}
          onRecheck={onRecheck}
          signedIn={false}
          onSignIn={vi.fn()}
        />
      </TooltipProvider>
    );

  it("reads as a pass for a call refused because the player already exists", () => {
    const { container } = txCard(
      {
        act: "call",
        ok: false,
        seconds: 1,
        message: "custom program error: 0x0",
        log: "",
        refused: { instruction: "initPlayer", error: { code: 0, name: null } },
        exists: {
          instruction: "init_player",
          account: "player",
          address: "Player1",
        },
      },
      { exists: "`player` already exists on devnet, so nothing was created." }
    );
    expect(screen.getByText("Already exists")).toBeTruthy();
    expect(screen.queryByText("Call failed")).toBeNull();
    expect(container.querySelector(".text-error")).toBeNull();
  });

  describe("a call devnet has not confirmed", () => {
    const UNCONFIRMED: RunResult = {
      act: "call",
      ok: false,
      seconds: 4,
      reason: "unconfirmed",
      message:
        "Devnet has not confirmed this transaction yet. Check again, or open it in Explorer.",
      log: "",
      unconfirmed: [
        { signature: "first", calls: [] },
        { signature: "5ig", calls: [] },
      ],
    };

    it("is not a failure: no red head, the message, the last signature as the meta's link", () => {
      const { container } = txCard(UNCONFIRMED);
      expect(screen.getByText("Not confirmed yet")).toBeTruthy();
      expect(screen.queryByText("Call failed")).toBeNull();
      expect(container.querySelector(".text-error")).toBeNull();
      expect(screen.getByText(UNCONFIRMED.message)).toBeTruthy();
      expect(screen.getByRole("link", { name: /↗/ }).getAttribute("href")).toBe(
        "https://explorer.solana.com/tx/5ig?cluster=devnet"
      );
      expect(screen.queryByRole("link", { name: /Explorer/ })).toBeNull();
    });

    it("offers Check again while it is open, and only then", async () => {
      const onRecheck = vi.fn();
      const { unmount } = txCard(UNCONFIRMED, { open: true, onRecheck });
      await userEvent.click(
        screen.getByRole("button", { name: "Check again" })
      );
      expect(onRecheck).toHaveBeenCalledOnce();
      unmount();
      txCard(UNCONFIRMED);
      expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
    });
  });

  const CHOP_ERROR =
    "Program log: AnchorError thrown in programs/lumberjack/src/lib.rs:31:9. Error Code: NotEnoughEnergy. Error Number: 6000. Error Message: Not enough energy.";

  it("heads a refused call with its error and keeps the error line in view", async () => {
    txCard({
      act: "call",
      ok: false,
      seconds: 0.9,
      message: "Not enough energy",
      log: ["Program log: Instruction: ChopTree", CHOP_ERROR].join("\n"),
      refused: {
        instruction: "chop_tree",
        error: { code: 6000, name: "NotEnoughEnergy" },
      },
    });
    expect(screen.getByText("Call failed")).toBeTruthy();
    expect(screen.getByText("NotEnoughEnergy · error 6000")).toBeTruthy();
    expect(screen.getByText(CHOP_ERROR)).toBeTruthy();
    expect(screen.getByText("Not enough energy")).toBeTruthy();
    // The record gave way to this card, so its time is in the details
    expect(screen.queryByText("Your call ran in 0.9 s.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Call failed/ }));
    expect(screen.getByText("Your call ran in 0.9 s.")).toBeTruthy();
  });

  const SIGNATURE = "5igHe11o";
  const HELLO_RUN: RunResult = {
    act: "run",
    ok: true,
    seconds: 2.4,
    signatures: [SIGNATURE],
    line: "Program log: Hello, World!",
    called: [{ instruction: "hello", args: {} }],
    receipt: {
      fee: 5000,
      computeUnits: 389,
      signer: "Wa11et",
      log: ["Program log: Instruction: Hello", "Program log: Hello, World!"],
    },
  };

  it("Hello from devnet: Confirmed with the instruction and the program's line", () => {
    txCard(HELLO_RUN);
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("Hello, World!")).toBeTruthy();
  });

  it("opens how it went from the head: the sentence, Copy signature and Explorer on devnet", async () => {
    txCard(HELLO_RUN);
    await userEvent.click(screen.getByRole("button", { name: /Details/ }));
    // `hello` is set as code, so the sentence is read across its parts
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "P" &&
          el.textContent ===
            "client.ts ran in 2.4 s and called hello. It used 389 compute units, and the fee was 0.000005 test SOL from your wallet."
      )
    ).toBeTruthy();
    expect(screen.getByText("hello", { selector: "p code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy signature" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Explorer/ }).getAttribute("href")
    ).toBe(`https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`);
    await userEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(screen.getByText(/Program log: Instruction: Hello/)).toBeTruthy();
  });

  it("heads a run the faucet left short, and one with no wallet, by their reason", () => {
    const { unmount } = txCard({
      act: "run",
      ok: false,
      seconds: 1,
      reason: "no_funds",
      message: "The airdrop failed",
      log: "",
      funding: { balance: 0, cost: 500_000_000, address: "Wa11et" },
    });
    expect(screen.getByText("Not enough devnet SOL")).toBeTruthy();
    expect(
      screen.getByText(
        "Your wallet has 0 SOL, and this run needs about 0.5 SOL. The devnet faucet is at its limit for now: try again in a minute, or top the wallet up yourself."
      )
    ).toBeTruthy();
    // The whole address, with Copy right after it rather than at the row's end
    expect(
      screen.getByRole("button", { name: "Copy" }).parentElement?.parentElement
        ?.parentElement?.textContent
    ).toBe("Wa11etCopy");
    expect(
      screen.getByRole("link", { name: /Open faucet/ }).getAttribute("href")
    ).toBe("https://faucet.solana.com/?walletAddress=Wa11et&cluster=devnet");
    unmount();
    txCard({
      act: "call",
      ok: false,
      seconds: 0,
      reason: "no_wallet",
      message: "Create a Playground wallet or connect one, then try again.",
      log: "",
    });
    expect(screen.getByText("No wallet")).toBeTruthy();
    expect(
      screen.getByText(
        "Create a Playground wallet or connect one, then try again."
      )
    ).toBeTruthy();
  });

  it("reads a run that sent nothing as no transaction, not a red card", () => {
    txCard({
      act: "run",
      ok: false,
      seconds: 1,
      reason: "no_transaction",
      message: "client.ts sent no transaction. See the terminal.",
      log: "",
    });
    expect(screen.getByText("No transaction")).toBeTruthy();
    expect(
      screen.getByText("client.ts sent none · see the terminal")
    ).toBeTruthy();
  });

  const failed = {
    act: "build" as const,
    ok: false as const,
    seconds: 1.6,
    reason: "compiler" as const,
    log: "",
    error: {
      code: "E0412",
      file: "src/lib.rs",
      line: 9,
      column: 32,
      message: "cannot find type `Contex` in this scope",
    },
  };

  it("heads a passing build with its IDL", () => {
    render(
      <BaseResultCard
        result={{
          act: "build",
          ok: true,
          seconds: 1.6,
          instructions: ["hello"],
        }}
        planned={null}
        open={false}
        onExplain={vi.fn()}
        onFixMyself={vi.fn()}
        onShowLine={vi.fn()}
        onRetry={vi.fn()}
        onRecheck={vi.fn()}
        signedIn={false}
        onSignIn={vi.fn()}
      />
    );
    expect(screen.getByText("Build successful")).toBeTruthy();
    expect(screen.getByText("IDL: 1 instruction · hello · 1.6 s")).toBeTruthy();
  });

  it("heads a deploy with its cost, and one recognised after a reload without one", () => {
    const deployed = (lamports: number | null) => (
      <BaseResultCard
        result={{
          act: "deploy",
          ok: true,
          seconds: 9,
          programId: "Prog1111",
          signature: "sig",
          upgraded: false,
          lamports,
          instructions: ["hello"],
        }}
        planned={null}
        open={false}
        onExplain={vi.fn()}
        onFixMyself={vi.fn()}
        onShowLine={vi.fn()}
        onRetry={vi.fn()}
        onRecheck={vi.fn()}
        signedIn={false}
        onSignIn={vi.fn()}
      />
    );
    const { unmount } = render(deployed(1_250_000_000));
    expect(screen.getByText("1.25 devnet SOL from your wallet")).toBeTruthy();
    unmount();
    render(deployed(null));
    expect(screen.getByText("Deployed")).toBeTruthy();
    expect(screen.queryByText(/devnet SOL from your wallet/)).toBeNull();
  });

  it("opens a failed build with its line, its location and Explain", async () => {
    const onExplain = vi.fn();
    const onFixMyself = vi.fn();
    const onShowLine = vi.fn();
    render(
      <BaseResultCard
        result={failed}
        planned="The compiler is right: it is spelled `Context`."
        open
        onExplain={onExplain}
        onFixMyself={onFixMyself}
        onShowLine={onShowLine}
        onRetry={vi.fn()}
        onRecheck={vi.fn()}
        signedIn={false}
        onSignIn={vi.fn()}
      />
    );
    expect(screen.getByText("Build failed")).toBeTruthy();
    expect(screen.getByText("E0412 · line 9")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "--> src/lib.rs:9:32" })
    );
    expect(onShowLine).toHaveBeenCalledWith("src/lib.rs", 9);
    const explain = screen.getByRole("button", { name: /Explain the error/ });
    expect(explain.textContent).not.toContain("⌘↵");
    await userEvent.click(explain);
    expect(onExplain).toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "I'll fix it myself" })
    );
    expect(onFixMyself).toHaveBeenCalled();
  });

  it("offers Try again, and no Explain, when the build server never answered", async () => {
    const onRetry = vi.fn();
    render(
      <BaseResultCard
        result={{
          act: "build",
          ok: false,
          seconds: 0,
          reason: "unreachable",
          error: null,
          log: "Server request failed: Failed to fetch",
        }}
        planned={null}
        open
        onExplain={vi.fn()}
        onFixMyself={vi.fn()}
        onShowLine={vi.fn()}
        onRetry={onRetry}
        onRecheck={vi.fn()}
        signedIn={false}
        onSignIn={vi.fn()}
      />
    );
    expect(screen.getByText("Build server unreachable")).toBeTruthy();
    expect(
      screen.getByText(
        "Build couldn't start. The Playground server didn't answer. Your code is unchanged."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Explain/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  describe("a build refused for sign-in", () => {
    const refused = {
      act: "build",
      ok: false,
      seconds: 0,
      reason: "signed_out",
      error: null,
      log: "Sign in with GitHub to build.",
    } as const;
    const card = (signedIn: boolean) => {
      const on = { retry: vi.fn(), signIn: vi.fn(async () => {}) };
      render(
        <BaseResultCard
          result={refused}
          planned={null}
          open
          onExplain={vi.fn()}
          onFixMyself={vi.fn()}
          onShowLine={vi.fn()}
          onRetry={on.retry}
          onRecheck={vi.fn()}
          signedIn={signedIn}
          onSignIn={on.signIn}
        />
      );
      return on;
    };

    it("asks a signed-out learner to sign in, with no Explain", async () => {
      const on = card(false);
      expect(screen.getByText("Sign in to build")).toBeTruthy();
      expect(screen.queryByText("Build failed")).toBeNull();
      expect(
        screen.getByText(
          "Builds run on Playground's build server, which needs a GitHub sign-in. Your code stays in this browser."
        )
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Explain/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Build/ })).toBeNull();
      await userEvent.click(
        screen.getByRole("button", { name: /Sign in with GitHub/ })
      );
      expect(on.signIn).toHaveBeenCalledTimes(1);
      expect(on.retry).not.toHaveBeenCalled();
    });

    it("reads Build once signed in, and runs the build", async () => {
      const on = card(true);
      expect(screen.getByText("Sign in to build")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /Sign in with GitHub/ })
      ).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: /^Build/ }));
      expect(on.retry).toHaveBeenCalledTimes(1);
      expect(on.signIn).not.toHaveBeenCalled();
    });
  });

  it("shows the log, with no line link, for a failure no line names", () => {
    render(
      <BaseResultCard
        result={{
          act: "build",
          ok: false,
          seconds: 0.4,
          reason: "compiler",
          error: null,
          log: "Server request failed (https://api.solpg.io/build): Invalid path",
        }}
        planned={null}
        open
        onExplain={vi.fn()}
        onFixMyself={vi.fn()}
        onShowLine={vi.fn()}
        onRetry={vi.fn()}
        onRecheck={vi.fn()}
        signedIn={false}
        onSignIn={vi.fn()}
      />
    );
    expect(screen.getByText(/Invalid path/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /-->/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Explain the error/ })
    ).toBeTruthy();
  });

  it("shows the log too when the error it names has no line", () => {
    render(
      <BaseResultCard
        result={{
          act: "build",
          ok: false,
          seconds: 2,
          reason: "compiler",
          error: {
            code: null,
            file: null,
            line: null,
            column: null,
            message: "linking with `cc` failed",
          },
          log: "error: linking with `cc` failed: exit status: 1",
        }}
        planned={null}
        open
        onExplain={vi.fn()}
        onFixMyself={vi.fn()}
        onShowLine={vi.fn()}
        onRetry={vi.fn()}
        onRecheck={vi.fn()}
        signedIn={false}
        onSignIn={vi.fn()}
      />
    );
    expect(screen.getByText(/exit status: 1/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /-->/ })).toBeNull();
  });

  it("folds to its head once it is a record, and the head opens it again", async () => {
    const onShowLine = vi.fn();
    render(
      <BaseResultCard
        result={failed}
        planned={null}
        open={false}
        onExplain={vi.fn()}
        onFixMyself={vi.fn()}
        onShowLine={onShowLine}
        onRetry={vi.fn()}
        onRecheck={vi.fn()}
        signedIn={false}
        onSignIn={vi.fn()}
      />
    );
    expect(screen.getByText("E0412 on line 9")).toBeTruthy();
    expect(screen.queryByText(/cannot find type/)).toBeNull();
    const head = screen.getByRole("button", { name: /Build failed/ });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("E0412 · line 9")).toBeTruthy();
    expect(screen.getByText(/cannot find type/)).toBeTruthy();
    // The prototype's failed build says no time, live or opened
    expect(screen.queryByText(/ in \d/)).toBeNull();
    // A record reveals its line too, but asks for nothing
    await userEvent.click(
      screen.getByRole("button", { name: "--> src/lib.rs:9:32" })
    );
    expect(onShowLine).toHaveBeenCalledWith("src/lib.rs", 9);
    expect(screen.queryByRole("button", { name: /Explain/ })).toBeNull();
  });
});

describe("BaseQuestionRecord", () => {
  const ask = requireFor("a question beat")(
    definition.steps
      .flatMap((s) => s.beats)
      .find((b): b is Ask => b.kind === "ask")
  );

  it.each([
    ["first_try", 1, "· first try"],
    ["retry", 2, "· 2nd try"],
    ["retry", 3, "· 3rd try"],
    ["typed", 1, "· typed by you"],
    ["skipped", 1, "· skipped"],
    ["call_panel", 1, "· skipped, called from the Call panel"],
  ] as const)(
    "records %s after %i attempts as %s",
    (outcome, attempts, end) => {
      render(
        <BaseQuestionRecord
          ask={ask}
          label="Q1"
          outcome={outcome}
          attempts={attempts}
          wrong={[]}
        />
      );
      const record = screen.getByRole("button");
      expect(record.textContent).toContain(end);
      expect(record.textContent).toContain(ask.options[ask.answer]);
      expect(record.textContent?.startsWith("Q1")).toBe(true);
    }
  );

  it("opens to the question and its three rows with their reasons, and closes again", async () => {
    const wrong = ask.answer === 0 ? 1 : 0;
    render(
      <BaseQuestionRecord
        ask={ask}
        label="Q1"
        outcome="retry"
        attempts={2}
        wrong={[wrong]}
      />
    );
    const record = screen.getByRole("button");
    expect(record.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(record);
    expect(record.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(ask.question as string)).toBeTruthy();
    const rows = document.querySelectorAll("[data-state]");
    expect(rows).toHaveLength(3);
    expect(rows[wrong].getAttribute("data-state")).toBe("wrong");
    expect(rows[ask.answer].getAttribute("data-state")).toBe("right");
    await userEvent.click(record);
    expect(document.querySelectorAll("[data-state]")).toHaveLength(0);
  });
});

describe("TurnView", () => {
  const step = definition.steps[0];
  const ask = requireFor("a question beat")(
    step.beats.find((b): b is Ask => b.kind === "ask")
  );
  const on = (): TurnHandlers => ({
    start: vi.fn(),
    pick: vi.fn(),
    hint: vi.fn(),
    skip: vi.fn(),
    typeIt: vi.fn(),
    act: vi.fn(),
    recheck: vi.fn(),
    explain: vi.fn(),
    fixMyself: vi.fn(),
    showFix: vi.fn(),
    next: vi.fn(),
    restartStep: vi.fn(),
    openNextTutorial: vi.fn(),
    allTutorials: vi.fn(),
    copyReceipt: vi.fn(),
    copyFailed: vi.fn(),
    apply: vi.fn(),
    keep: vi.fn(),
    showLine: vi.fn(),
    revealError: vi.fn(),
    showLog: vi.fn(),
    createWallet: vi.fn(),
    signIn: vi.fn(),
  });
  const draw = (turn: Turn, live: boolean, handlers = on()) =>
    render(
      <TooltipProvider>
        <TurnView
          turn={turn}
          definition={definition}
          live={live}
          running={false}
          passed={[]}
          read={() => null}
          nextTutorial={null}
          on={handlers}
        />
      </TooltipProvider>
    );

  it("names the program step 4 upgrades in its act card, or says your program before there is one", () => {
    const ship = actOf("s4.ship");
    const turn: Turn = {
      id: ship.id,
      kind: "act",
      step: "upgrade",
      at: 1,
      whole: true,
      beatId: ship.id,
      act: ship,
      state: "live",
      presses: [],
      note: null,
      stage: null,
      took: null,
    };
    const drawn = (programId: string | null) =>
      render(
        <TurnView
          turn={turn}
          definition={definition}
          live
          running={false}
          passed={[]}
          read={() => null}
          nextTutorial={null}
          programId={programId}
          on={on()}
        />
      );
    const { unmount } = drawn("HeLLo1111111111111111111111111111111111Anch");
    expect(
      screen.getByText("Upgrades HeLLo1…11Anch in place · from your wallet")
    ).toBeTruthy();
    unmount();
    drawn(null);
    expect(
      screen.getByText("Upgrades your program in place · from your wallet")
    ).toBeTruthy();
  });

  it("draws a deploy's result as the deploy card, open under its live Try again", async () => {
    const handlers = on();
    draw(
      {
        id: "result:s2.deploy:0",
        kind: "result",
        step: "deploy",
        at: 2,
        whole: true,
        beatId: "s2.deploy",
        act: "deploy",
        result: {
          act: "deploy",
          ok: false,
          seconds: 0,
          reason: "no_wallet",
          message: "No wallet",
        },
        took: 0,
        planned: null,
        open: true,
      },
      false,
      handlers
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Create wallet/ })
    );
    expect(handlers.createWallet).toHaveBeenCalledWith("s2.deploy");
  });

  it("opens the terminal from a landed deploy's Log", async () => {
    const handlers = on();
    draw(
      {
        id: "result:s2.deploy:0",
        kind: "result",
        step: "deploy",
        at: 2,
        whole: true,
        beatId: "s2.deploy",
        act: "deploy",
        result: {
          act: "deploy",
          ok: true,
          seconds: 9,
          programId: "Prog1111",
          signature: "sig",
          upgraded: false,
          lamports: 1_000_000_000,
          instructions: ["hello"],
        },
        took: 9000,
        planned: null,
        open: false,
      },
      false,
      handlers
    );
    await userEvent.click(screen.getByRole("button", { name: /Details/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Log/ }));
    expect(handlers.showLog).toHaveBeenCalled();
  });

  const openAsk: Turn = {
    id: ask.id,
    kind: "ask",
    step: step.id,
    at: 1,
    whole: true,
    beatId: ask.id,
    ask,
    open: true,
    wrong: [],
    hinted: false,
    writeFailed: false,
    outcome: null,
    attempts: 0,
  };
  const openFailure: Turn = {
    id: "result:s1.build:0",
    kind: "result",
    step: step.id,
    at: 2,
    whole: true,
    beatId: "s1.build",
    act: "build",
    result: {
      act: "build",
      ok: false,
      reason: "compiler",
      seconds: 1,
      error: null,
      log: "",
    },
    took: 1000,
    planned: null,
    open: true,
  };
  const liveWin: Turn = {
    id: `win:${step.id}`,
    kind: "win",
    step: step.id,
    at: 3,
    whole: true,
    stepId: step.id,
    win: step.win,
    done: false,
    took: 41_000,
    via: "chat",
    last: false,
  };

  it.each([
    ["a question", openAsk],
    ["a failed build", openFailure],
    ["a win", liveWin],
  ])("draws %s with its buttons while it is the live card", (_, turn) => {
    draw(turn, true);
    expect(screen.queryAllByRole("button").length).toBeGreaterThan(0);
  });

  it.each([
    ["a question", openAsk],
    ["a failed build", openFailure],
    ["a win", liveWin],
  ])(
    "draws %s with no button that acts once another card is live",
    (_, turn) => {
      draw(turn, false);
      // A folded failed build's head only opens it again, to read
      const acting = screen
        .queryAllByRole("button")
        .filter((b) => !b.hasAttribute("aria-expanded"));
      expect(acting).toHaveLength(0);
    }
  );

  const appended: Turn = {
    id: "wrote:s1.q1",
    kind: "wrote",
    step: step.id,
    at: 3,
    whole: true,
    beatId: "s1.q1",
    wrote: { file: "src/lib.rs", lines: [9], appended: true },
    failed: false,
  };
  const drawWrote = (passed: string[], running: boolean) => {
    const handlers = on();
    render(
      <TurnView
        turn={appended}
        definition={definition}
        live={false}
        running={running}
        passed={passed}
        read={() => null}
        nextTutorial={null}
        on={handlers}
      />
    );
    return handlers;
  };

  it("restarts the step from an appended block's confirmed Reset while the step is on", async () => {
    const handlers = drawWrote([], false);
    await userEvent.click(screen.getByRole("button", { name: /^Reset/ }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(handlers.restartStep).toHaveBeenCalledTimes(1);
  });

  it("holds Reset while an act runs", () => {
    drawWrote([], true);
    expect(
      (screen.getByRole("button", { name: /^Reset/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("offers no Reset once the block's step has passed", () => {
    drawWrote([step.id], false);
    expect(screen.queryByRole("button", { name: /^Reset/ })).toBeNull();
  });
});

describe("BaseWinCard", () => {
  const steps = definition.steps;
  const win = (
    i: number,
    over: Partial<Parameters<typeof BaseWinCard>[0]> = {}
  ) => {
    const onNext = over.onNext ?? vi.fn();
    const onWriteInClient = over.onWriteInClient ?? vi.fn();
    render(
      <BaseWinCard
        win={steps[i].win}
        index={i + 1}
        next={over.next === undefined ? steps[i + 1]?.title ?? null : over.next}
        via={over.via ?? "chat"}
        live={over.live ?? true}
        onNext={onNext}
        onOpenCall={over.onOpenCall}
        onWriteInClient={onWriteInClient}
      />
    );
    return { onNext, onWriteInClient };
  };

  it("draws the check, the tag, the headline and line, and Next with ↵", async () => {
    const { onNext } = win(0);
    const card = screen.getByRole("region", { name: "Step 1 done" });
    expect(within(card).getByRole("img", { name: "Passed" })).toBeTruthy();
    expect(within(card).getByText("Step 1 done")).toBeTruthy();
    const next = within(card).getByRole("button", {
      name: `Next: ${steps[1].title}`,
    });
    await userEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("goes Next on Enter while nothing holds focus, and not while typing", () => {
    const { onNext } = win(0);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onNext).toHaveBeenCalledTimes(1);

    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onNext).toHaveBeenCalledTimes(1);
    field.remove();
  });

  it("has no Next on the last step's win", () => {
    const { onNext } = win(steps.length - 1, { next: null });
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onNext).not.toHaveBeenCalled();
  });

  it("reads the Call panel line after a pass from the panel, and offers client.ts", async () => {
    const i = steps.findIndex((s) => s.win.callPanelLine);
    const callPanelLine = steps[i]?.win.callPanelLine;
    if (!callPanelLine) throw new Error("Hello Anchor has no Call panel line");
    const { onWriteInClient } = win(i, { via: "call_panel" });
    // Prose draws `code` spans without their backticks
    const panelLine = textOf(callPanelLine, false).replace(/`/g, "");
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "P" && el.textContent === panelLine
      )
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Write it in client.ts" })
    );
    expect(onWriteInClient).toHaveBeenCalledTimes(1);
  });

  describe("on Lumberjack's step 2", () => {
    const create = (lumberjack as unknown as TutorialDefinition).steps[1];
    /** The paragraph that reads `text`, as Prose draws it without backticks */
    const paragraph = (text: NonNullable<typeof create.win.existsLine>) => {
      const plain = textOf(text, false).replace(/`/g, "");
      return screen.queryByText(
        (_, el) => el?.tagName === "P" && el.textContent === plain
      );
    };
    const winOf = (reason: "exists" | undefined) =>
      render(
        <BaseWinCard
          win={create.win}
          index={2}
          next="Chop"
          via="call_panel"
          reason={reason}
          live
          onNext={vi.fn()}
          onWriteInClient={vi.fn()}
        />
      );

    it("explains a player that already existed, then offers Next", () => {
      winOf("exists");
      const existsLine = requireFor("the existsLine")(create.win.existsLine);
      expect(paragraph(existsLine)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Next: Chop" })).toBeTruthy();
    });

    it("says nothing of an existing player after a pass that created it", () => {
      winOf(undefined);
      const existsLine = requireFor("the existsLine")(create.win.existsLine);
      expect(paragraph(existsLine)).toBeNull();
      expect(
        paragraph(requireFor("the callPanelLine")(create.win.callPanelLine))
      ).toBeTruthy();
    });
  });

  it("shows no Open Call without an opener", () => {
    const i = steps.findIndex((s) => s.win.extra === "openTest");
    win(i);
    expect(screen.queryByRole("button", { name: "Open Call" })).toBeNull();
  });

  it("opens the Call panel from Open Call once an opener is given", async () => {
    const i = steps.findIndex((s) => s.win.extra === "openTest");
    const onOpenCall = vi.fn();
    win(i, { onOpenCall });
    await userEvent.click(screen.getByRole("button", { name: "Open Call" }));
    expect(onOpenCall).toHaveBeenCalledTimes(1);
  });

  it("offers client.ts, not the panel again, after a pass from the panel", () => {
    const i = steps.findIndex((s) => s.win.callPanelLine);
    win(i, { via: "call_panel", onOpenCall: vi.fn() });
    expect(screen.queryByRole("button", { name: "Open Call" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Write it in client.ts/ })
    ).toBeTruthy();
  });

  it("reads its own line after a chat pass, and offers no client.ts", () => {
    const i = steps.findIndex((s) => s.win.callPanelLine);
    win(i, { via: "chat" });
    const line = textOf(steps[i].win.line, false).replace(/`/g, "");
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "P" && el.textContent === line
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Write it in client.ts" })
    ).toBeNull();
  });

  it("shows no Open Call on a win that does not ask for it", () => {
    const i = steps.findIndex((s) => !s.win.extra);
    win(i, { onOpenCall: vi.fn() });
    expect(screen.queryByRole("button", { name: "Open Call" })).toBeNull();
  });

  it("takes no Enter once it is a record", () => {
    const { onNext } = win(0, { live: false });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onNext).not.toHaveBeenCalled();
  });

  it("keeps Open Call on the record, as a navigation link", async () => {
    const i = steps.findIndex((s) => s.win.extra === "openTest");
    const onOpenCall = vi.fn();
    win(i, { live: false, onOpenCall });
    await userEvent.click(screen.getByRole("button", { name: "Open Call" }));
    expect(onOpenCall).toHaveBeenCalledTimes(1);
  });

  it("keeps no Next once it is a record, but keeps client.ts as a button", () => {
    win(0, { live: false, via: "call_panel" });
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Write it in client.ts" })
    ).toBeTruthy();
  });
});

describe("BaseFinishCard", () => {
  // Copy's tooltip positions itself with a `ResizeObserver`, which jsdom lacks
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const alex: LandedCall = {
    act: "call",
    ok: true,
    seconds: 0.9,
    signatures: ["5igFirst", "5igLastOfTheCall"],
    line: "Program log: Hello, Alex!",
    called: [],
  };
  const finish = (over: Partial<Parameters<typeof BaseFinishCard>[0]> = {}) => {
    const handlers = {
      onNext: vi.fn(),
      onAllTutorials: vi.fn(),
      onCopyReceipt: vi.fn(),
      onCopyError: vi.fn(),
    };
    render(
      <TooltipProvider>
        <BaseFinishCard
          headline={definition.finish.headline}
          line={definition.finish.line}
          learned={definition.finish.learned}
          steps={definition.steps.length}
          seconds={over.seconds ?? 252}
          receipt={over.receipt === undefined ? alex : over.receipt}
          next={over.next === undefined ? "Counter PDA Tutorial" : over.next}
          onNext={handlers.onNext}
          onAllTutorials={handlers.onAllTutorials}
          onCopyReceipt={handlers.onCopyReceipt}
          onCopyError={handlers.onCopyError}
        />
      </TooltipProvider>
    );
    return handlers;
  };

  it("finishes Hello Anchor with the receipt whose log reads Hello, Alex!", async () => {
    finish();
    const card = screen.getByRole("region", { name: "Finished" });
    // Marked as a win, like a step's
    expect(within(card).getByRole("img", { name: "Passed" })).toBeTruthy();
    expect(within(card).getByText("Tutorial complete")).toBeTruthy();
    await userEvent.click(
      within(card).getByRole("button", { name: /Transaction details/ })
    );
    expect(within(card).getByText("Program log: Hello, Alex!")).toBeTruthy();
    const explorer = within(card).getByRole("link", {
      name: "Signature in Explorer",
    });
    expect(explorer.getAttribute("href")).toBe(
      "https://explorer.solana.com/tx/5igLastOfTheCall?cluster=devnet"
    );
    expect(explorer.getAttribute("target")).toBe("_blank");
  });

  it("draws the fee, the signer and each account once the runner fills them", async () => {
    finish({
      receipt: {
        act: "call",
        ok: true,
        seconds: 0.9,
        signatures: ["5ig"],
        line: null,
        called: [],
        receipt: {
          fee: 5000,
          signer: "Wa11etAddressThatIsLong",
          accounts: [{ name: "program", address: "Pr0gramAddressLong" }],
          log: ["Program log: Hello, Alex!", "Program consumed 1200 units"],
        },
      },
    });
    await userEvent.click(
      screen.getByRole("button", { name: /Transaction details/ })
    );
    expect(screen.getByText("Your wallet · signer")).toBeTruthy();
    expect(screen.getByText("Fee 0.000005 devnet SOL")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "program in Explorer" })
        .getAttribute("href")
    ).toBe(
      "https://explorer.solana.com/address/Pr0gramAddressLong?cluster=devnet"
    );
    expect(screen.getByText(/Program consumed 1200 units/)).toBeTruthy();
  });

  it("reads what was learned, the meta line, and its two ways on", async () => {
    const { onNext, onAllTutorials } = finish();
    for (const item of definition.finish.learned) {
      expect(screen.getByText(item)).toBeTruthy();
    }
    expect(
      screen.getByText("4 steps · 4 min 12 s · devnet only, nothing real spent")
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Next: Counter PDA Tutorial" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "All tutorials" })
    );
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onAllTutorials).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/See summary/)).toBeNull();
  });

  it("has no Transaction details for a call that left nothing to show", () => {
    finish({
      receipt: {
        act: "call",
        ok: true,
        seconds: 0.9,
        signatures: [],
        line: null,
        called: [],
      },
    });
    expect(screen.queryByText("Transaction details")).toBeNull();
  });

  it("counts Copy receipt", async () => {
    const { onCopyReceipt } = finish();
    await userEvent.click(screen.getByRole("button", { name: "Copy receipt" }));
    expect(onCopyReceipt).toHaveBeenCalledTimes(1);
  });

  it("has no Transaction details without a landed call, and no Next without a next", () => {
    finish({ receipt: null, next: null });
    expect(screen.queryByText("Transaction details")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();
    expect(screen.getByRole("button", { name: "All tutorials" })).toBeTruthy();
  });
});

describe("TurnView's last win", () => {
  it("reads the last step's headline with no Next, as Hello Anchor finishes", () => {
    const last = definition.steps[definition.steps.length - 1];
    const turn: Turn = {
      id: `win:${last.id}`,
      kind: "win",
      step: last.id,
      at: 1,
      whole: true,
      stepId: last.id,
      win: last.win,
      done: false,
      took: 1000,
      via: "chat",
      last: true,
    };
    render(
      <TurnView
        turn={turn}
        definition={definition}
        live
        running={false}
        passed={[]}
        read={() => null}
        nextTutorial={null}
        on={{
          start: vi.fn(),
          pick: vi.fn(),
          hint: vi.fn(),
          skip: vi.fn(),
          typeIt: vi.fn(),
          act: vi.fn(),
          recheck: vi.fn(),
          explain: vi.fn(),
          fixMyself: vi.fn(),
          showFix: vi.fn(),
          next: vi.fn(),
          restartStep: vi.fn(),
          openNextTutorial: vi.fn(),
          allTutorials: vi.fn(),
          copyReceipt: vi.fn(),
          copyFailed: vi.fn(),
          apply: vi.fn(),
          keep: vi.fn(),
          showLine: vi.fn(),
          revealError: vi.fn(),
          showLog: vi.fn(),
          createWallet: vi.fn(),
          signIn: vi.fn(),
        }}
      />
    );
    expect(screen.getByText("hello knows your name")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();
  });
});

describe("BaseApplyCard", () => {
  const proposal = (
    state: "open" | "applied" | "kept",
    applyFailed?: ApplyFailure
  ): Proposal => {
    const p: Proposal = {
      id: "p1",
      file: "programs/hello/src/lib.rs",
      line: 10,
      before: '        msg!("Hello, {}!", name);',
      after: '        msg!("Once upon a time on devnet");',
      at: 1,
      state,
    };
    if (applyFailed) p.applyFailed = applyFailed;
    return p;
  };

  it("shows the line's diff with Apply to lib.rs and Keep it, and applies nothing itself", async () => {
    const onApply = vi.fn();
    const onKeep = vi.fn();
    render(
      <BaseApplyCard
        proposal={proposal("open")}
        onApply={onApply}
        onKeep={onKeep}
      />
    );
    expect(screen.getByText("programs/hello/src/lib.rs:10")).toBeTruthy();
    expect(
      screen.getByText('msg!("Once upon a time on devnet");', { exact: false })
    ).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Apply to lib.rs" })
    );
    expect(onApply).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it.each<[ApplyFailure, string]>([
    ["moved", "the line changed since"],
    ["write", "Could not write the file"],
  ])(
    "says why an Apply did not land (%s) and keeps its buttons",
    (reason, said) => {
      render(
        <BaseApplyCard
          proposal={proposal("open", reason)}
          onApply={vi.fn()}
          onKeep={vi.fn()}
        />
      );
      expect(screen.getByRole("status").textContent).toContain(said);
      expect(
        screen.getByRole("button", { name: "Apply to lib.rs" })
      ).toBeTruthy();
    }
  );

  it("ends a settled card with what happened, and no buttons", () => {
    const { rerender } = render(
      <BaseApplyCard
        proposal={proposal("applied")}
        onApply={vi.fn()}
        onKeep={vi.fn()}
      />
    );
    expect(screen.getByText("Applied.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(
      <BaseApplyCard
        proposal={proposal("kept")}
        onApply={vi.fn()}
        onKeep={vi.fn()}
      />
    );
    expect(screen.getByText("Kept yours.")).toBeTruthy();
  });
});

describe("TurnView's chip answer", () => {
  const handlers = (): TurnHandlers => ({
    start: vi.fn(),
    pick: vi.fn(),
    hint: vi.fn(),
    skip: vi.fn(),
    typeIt: vi.fn(),
    act: vi.fn(),
    recheck: vi.fn(),
    explain: vi.fn(),
    fixMyself: vi.fn(),
    next: vi.fn(),
    restartStep: vi.fn(),
    openNextTutorial: vi.fn(),
    allTutorials: vi.fn(),
    copyReceipt: vi.fn(),
    copyFailed: vi.fn(),
    apply: vi.fn(),
    keep: vi.fn(),
    showLine: vi.fn(),
    openMenu: vi.fn(),
    showFix: vi.fn(),
    revealError: vi.fn(),
    showLog: vi.fn(),
    createWallet: vi.fn(),
    signIn: vi.fn(),
  });
  const reply = (follow: Follow | null): Turn => ({
    id: "reply:0",
    kind: "reply",
    step: null,
    at: 1,
    whole: true,
    text: "Counter PDA Tutorial is a good next one.",
    follow,
  });
  const draw = (
    follow: Follow | null,
    on: TurnHandlers,
    nextTutorial: string | null
  ) =>
    render(
      <TurnView
        turn={reply(follow)}
        definition={definition}
        live={false}
        running={false}
        passed={[]}
        read={() => null}
        nextTutorial={nextTutorial}
        on={on}
      />
    );

  it("follows the answer with a quiet button that opens the next tutorial", async () => {
    const on = handlers();
    draw("nextTutorial", on, "Counter PDA Tutorial");
    expect(
      screen.getByText("Counter PDA Tutorial is a good next one.")
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Open Counter PDA Tutorial" })
    );
    expect(on.openNextTutorial).toHaveBeenCalledTimes(1);
  });

  it("opens the menu through the frame's handler", async () => {
    const on = handlers();
    draw("showMenu", on, null);
    await userEvent.click(
      screen.getByRole("button", { name: "Show the menu" })
    );
    expect(on.openMenu).toHaveBeenCalledTimes(1);
  });

  it("opens the client file at its top, as the win card's button does", async () => {
    const on = handlers();
    draw("writeClient", on, null);
    await userEvent.click(
      screen.getByRole("button", { name: "Write it in client.ts" })
    );
    expect(on.showLine).toHaveBeenCalledWith("client/client.ts", 1);
  });

  it.each<[string, Follow | null, string | null]>([
    ["no follow", null, "Counter PDA Tutorial"],
    ["a next tutorial that is not listed", "nextTutorial", null],
    ["Open Call before the panel can open", "openTest", null],
    ["a fix no tutorial shows", "showFix", null],
  ])("draws no button for %s", (_, follow, nextTutorial) => {
    draw(follow, handlers(), nextTutorial);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
