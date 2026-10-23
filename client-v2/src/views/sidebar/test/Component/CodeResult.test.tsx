// A fetched account or received events: JSON the user can copy whole.
import { render } from "@testing-library/react";
import { expect, it } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import CodeResult from "./CodeResult";

it("the JSON comes with a copy button and its title", () => {
  const { container } = render(
    <TooltipProvider>
      <CodeResult>{'{\n  "count": "1"\n}'}</CodeResult>
    </TooltipProvider>
  );
  expect(
    container.querySelector('[data-slot="code-block-title"]')!.textContent
  ).toBe("JSON");
  expect(container.querySelector('[data-slot="copy-button"]')).not.toBeNull();
  expect(
    container.querySelector('[data-slot="code-block-content"]')!.textContent
  ).toContain('"count": "1"');
});
