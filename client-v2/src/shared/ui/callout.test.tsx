import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AsyncButton } from "./async-button";
import { CalloutAction } from "./callout";

/* jsdom cannot apply a stylesheet, so the look is read from the class list */
describe("CalloutAction", () => {
  afterEach(cleanup);

  const plain = () => {
    render(<CalloutAction>Plain</CalloutAction>);
    return screen.getByRole("button", { name: "Plain" });
  };
  const lent = () => {
    render(
      <CalloutAction asChild>
        <AsyncButton variant="ghost" size="sm">
          Lent
        </AsyncButton>
      </CalloutAction>
    );
    return screen.getByRole("button", { name: "Lent" });
  };

  it("is 44 px on a phone, plain or lent to a button", () => {
    expect(plain().className).toContain("max-md:h-11");
    expect(lent().className).toContain("max-md:h-11");
  });

  it("leaves nothing of Button's look on a lent action", () => {
    const { className } = lent();
    expect(className).not.toContain("hover:bg-muted");
    expect(className).not.toContain("hover:text-foreground");
    expect(className).not.toContain("translate-y-px");
    expect(className).not.toContain("bg-clip-padding");
    expect(className.split(" ")).not.toContain("border");
  });

  it("uses the same fill plain and lent", () => {
    const fill = (name: string) =>
      name.split(" ").filter((c) => c.includes("--action"));
    const plainFill = fill(plain().className);
    expect(plainFill.length).toBeGreaterThan(0);
    expect(fill(lent().className)).toEqual(plainFill);
  });
});
