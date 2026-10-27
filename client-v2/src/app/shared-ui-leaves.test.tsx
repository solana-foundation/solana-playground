// The design system's leaf elements mount and respond in client-v2 as
// installed: React 19, our aliases and jsdom, with no edit by hand.
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "@/shared/ui/avatar";
import { Badge } from "@/shared/ui/badge";
import { Callout } from "@/shared/ui/callout";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";
import { Empty, EmptyDescription, EmptyTitle } from "@/shared/ui/empty";
import { Kbd } from "@/shared/ui/kbd";
import { Label } from "@/shared/ui/label";
import { Logo } from "@/shared/ui/logo";
import { StatusDot } from "@/shared/ui/status-dot";
import { Switch } from "@/shared/ui/switch";
import { Tag, levelVariant } from "@/shared/ui/tag";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // A React warning during render is a failure here, not noise.
  consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function slot(container: HTMLElement, name: string) {
  return container.querySelector(`[data-slot="${name}"]`);
}

describe("shared/ui leaf elements", () => {
  it("flips a checkbox from its label", () => {
    render(
      <Label>
        <Checkbox />
        Accept
      </Label>
    );
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByText("Accept"));

    expect(box.getAttribute("aria-checked")).toBe("true");
  });

  it("opens a collapsible from its trigger", () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>
          Details
          <CollapsibleChevron />
        </CollapsibleTrigger>
        <CollapsibleContent>Hidden text</CollapsibleContent>
      </Collapsible>
    );
    const trigger = screen.getByRole("button", { name: "Details" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Hidden text")).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Hidden text")).toBeTruthy();
  });

  it("dresses a fold heading and leaves the plain trigger bare", () => {
    render(
      <>
        <Collapsible>
          <CollapsibleHeading>Fold</CollapsibleHeading>
        </Collapsible>
        <Collapsible>
          <CollapsibleTrigger>Bare</CollapsibleTrigger>
        </Collapsible>
      </>
    );

    const heading = screen.getByRole("button", { name: "Fold" });
    expect(heading.className).toContain("select-none");
    expect(heading.className).toContain("w-fit");
    expect(heading.className).toContain("hover:text-foreground");
    expect(screen.getByRole("button", { name: "Bare" }).className).toBe("");
  });

  it.each([
    ["error", "alert"],
    ["warning", "alert"],
    ["default", "note"],
    ["info", "note"],
    ["success", "note"],
  ] as const)("gives a %s callout the %s role", (variant, role) => {
    render(<Callout variant={variant}>Said</Callout>);

    expect(screen.getByRole(role).textContent).toBe("Said");
  });

  it("lets an explicit role win over the variant's", () => {
    render(
      <Callout variant="error" role="status">
        Calm
      </Callout>
    );

    expect(screen.getByRole("status").textContent).toBe("Calm");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("colours a tag by level and falls back to error", () => {
    const { container } = render(
      <Tag variant={levelVariant("Beginner")}>Beginner</Tag>
    );

    expect(slot(container, "tag")?.getAttribute("data-variant")).toBe(
      "success"
    );
    expect(levelVariant("Unknown")).toBe("error");
  });

  it("mounts the remaining leaves with their data-slot", () => {
    const { container } = render(
      <div>
        <Kbd>K</Kbd>
        <Badge>New</Badge>
        <Empty>
          <EmptyTitle>Nothing</EmptyTitle>
          <EmptyDescription>Add one</EmptyDescription>
        </Empty>
        <StatusDot />
        <Avatar />
        <Logo />
        <Switch />
      </div>
    );

    for (const name of [
      "kbd",
      "badge",
      "empty",
      "status-dot",
      "avatar",
      "logo",
      "switch",
    ]) {
      expect(slot(container, name), name).not.toBeNull();
    }
  });
});
