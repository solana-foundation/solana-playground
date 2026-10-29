// The approval card draws one request and answers it through `onAnswer`.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import { BaseApprovalCard } from "./BaseApprovalCard";
import type { ApprovalItem } from "./BaseApprovalCard";

const CREATED = "2026-10-19T00:00:00.000Z";

const commandCard = (status: ApprovalItem["status"]): ApprovalItem => ({
  id: "card-1",
  createdAt: CREATED,
  kind: "approval",
  status,
  request: { type: "command", name: "build", effect: "Compiles the program" },
});

const patchCard = (
  before: string | null,
  after: string,
  status: ApprovalItem["status"] = "pending"
): ApprovalItem => ({
  id: "card-2",
  createdAt: CREATED,
  kind: "approval",
  status,
  request: { type: "patch", path: "src/lib.rs", before, after },
});

const ANSWERS = /^(Apply|Reject|Allow|Deny)$/;

describe("BaseApprovalCard", () => {
  it("allows the request it shows", () => {
    const onAnswer = vi.fn();
    render(
      <BaseApprovalCard item={commandCard("pending")} onAnswer={onAnswer} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("allow");
  });

  it("denies with Reject on a patch", () => {
    const onAnswer = vi.fn();
    render(<BaseApprovalCard item={patchCard("a", "b")} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onAnswer).toHaveBeenCalledWith("deny");
  });

  it("names the file and its counts", () => {
    render(
      <BaseApprovalCard
        item={patchCard("a\nb", "a\nc\nd")}
        onAnswer={vi.fn()}
      />
    );
    expect(screen.getByText("src/lib.rs")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("−1")).toBeTruthy();
  });

  it("a new file counts every line added", () => {
    render(
      <BaseApprovalCard item={patchCard(null, "x\ny")} onAnswer={vi.fn()} />
    );
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("−0")).toBeTruthy();
  });

  it("a command shows what it runs", () => {
    render(
      <BaseApprovalCard item={commandCard("pending")} onAnswer={vi.fn()} />
    );
    expect(screen.getByText("wants to run build")).toBeTruthy();
    expect(screen.getByText("$ build")).toBeTruthy();
    expect(screen.getByText("Compiles the program")).toBeTruthy();
  });

  it("a command's lines are phrasing content inside the pre", () => {
    const { container } = render(
      <BaseApprovalCard item={commandCard("pending")} onAnswer={vi.fn()} />
    );
    expect(container.querySelectorAll("pre div")).toHaveLength(0);
  });

  it("an unanswered card says the session ended", () => {
    render(
      <BaseApprovalCard
        item={patchCard("a", "b", "unanswered")}
        onAnswer={vi.fn()}
      />
    );
    expect(screen.getByText("Not answered")).toBeTruthy();
    expect(
      screen.getByText("not applied -- the session ended before you answered")
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: ANSWERS })).toBeNull();
  });

  it("an answered card shows its outcome", () => {
    const item: ApprovalItem = {
      id: "card-3",
      createdAt: CREATED,
      kind: "approval",
      status: "allowed",
      outcome: "Wrote src/lib.rs",
      request: { type: "patch", path: "src/lib.rs", before: "a", after: "b" },
    };
    render(<BaseApprovalCard item={item} onAnswer={vi.fn()} />);
    expect(screen.getByText("Wrote src/lib.rs")).toBeTruthy();
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: ANSWERS })).toBeNull();
  });

  it("a declined card says so", () => {
    render(
      <BaseApprovalCard item={commandCard("denied")} onAnswer={vi.fn()} />
    );
    expect(screen.getByText("Declined")).toBeTruthy();
    expect(screen.getByText("not applied")).toBeTruthy();
  });

  it("the actions are thumb-sized on a phone", () => {
    render(<BaseApprovalCard item={patchCard("a", "b")} onAnswer={vi.fn()} />);
    const apply = screen.getByRole("button", { name: "Apply" });
    const reject = screen.getByRole("button", { name: "Reject" });
    for (const button of [apply, reject]) {
      expect(button.classList.contains("h-11")).toBe(true);
      expect(button.classList.contains("md:h-8")).toBe(true);
    }
  });

  describe("Undo patch", () => {
    const request = {
      type: "patch",
      path: "src/lib.rs",
      before: "a",
      after: "b",
    } as const;
    const appliedCard = (): ApprovalItem => ({
      id: "card-3",
      createdAt: CREATED,
      kind: "approval",
      status: "allowed",
      outcome: "wrote src/lib.rs",
      request,
    });
    const undoneCard = (): ApprovalItem => ({
      id: "card-3",
      createdAt: CREATED,
      kind: "approval",
      status: "allowed",
      outcome: "undone, src/lib.rs is back as it was",
      undone: true,
      request,
    });

    it("offers Undo patch on an applied card it can take back", () => {
      const onUndo = vi.fn();
      render(
        <BaseApprovalCard
          item={appliedCard()}
          onAnswer={vi.fn()}
          onUndo={onUndo}
        />
      );
      expect(screen.getByText("Applied")).toBeTruthy();
      const undo = screen.getByRole("button", { name: "Undo patch" });
      // A thumb's target on a phone, both ways
      expect(undo.className).toContain("h-11");
      expect(undo.className).toContain("min-w-11");
      fireEvent.click(undo);
      expect(onUndo).toHaveBeenCalledTimes(1);
    });

    it("offers the original to copy when Undo could not finish", () => {
      render(
        <TooltipProvider>
          <BaseApprovalCard
            item={appliedCard()}
            onAnswer={vi.fn()}
            original="old"
          />
        </TooltipProvider>
      );
      const copy = screen.getByRole("button", { name: "Copy the original" });
      expect(copy.className).toContain("size-11");
      expect(screen.queryByRole("button", { name: "Undo patch" })).toBeNull();
      const writeText = vi.fn(async () => {});
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      try {
        fireEvent.click(copy);
        expect(writeText).toHaveBeenCalledWith("old");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("offers the original even when it was an empty file", () => {
      render(
        <TooltipProvider>
          <BaseApprovalCard
            item={appliedCard()}
            onAnswer={vi.fn()}
            original=""
          />
        </TooltipProvider>
      );
      expect(
        screen.getByRole("button", { name: "Copy the original" })
      ).toBeTruthy();
    });

    it("offers nothing to copy without an original", () => {
      render(<BaseApprovalCard item={appliedCard()} onAnswer={vi.fn()} />);
      expect(
        screen.queryByRole("button", { name: "Copy the original" })
      ).toBeNull();
    });

    it("reads an undo that did not finish as a warning", () => {
      const card: ApprovalItem = {
        id: "card-4",
        createdAt: CREATED,
        kind: "approval",
        status: "allowed",
        outcome: "Undo did not finish: src/lib.rs changed while Undo wrote it.",
        request,
      };
      render(<BaseApprovalCard item={card} onAnswer={vi.fn()} />);
      expect(
        screen.getByText(
          "Undo did not finish: src/lib.rs changed while Undo wrote it."
        ).className
      ).toContain("text-warning");
    });

    it("offers no Undo patch without onUndo", () => {
      render(<BaseApprovalCard item={appliedCard()} onAnswer={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Undo patch" })).toBeNull();
    });

    it("reads Undone once taken back", () => {
      render(<BaseApprovalCard item={undoneCard()} onAnswer={vi.fn()} />);
      expect(screen.getByText("Undone")).toBeTruthy();
      expect(screen.queryByText("Applied")).toBeNull();
      expect(
        screen.getByText("undone, src/lib.rs is back as it was")
      ).toBeTruthy();
    });
  });
});
