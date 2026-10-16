import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("../../views/flow", () => ({
  default: () => <div data-testid="flow" />,
}));

it("should render Flow even with ?classic in the URL", async () => {
  window.history.replaceState(null, "", "/?classic");
  vi.resetModules();
  const { default: Panels } = await import("./Panels");
  const { getByTestId } = render(<Panels />);
  expect(getByTestId("flow")).toBeTruthy();
  window.history.replaceState(null, "", "/");
});
