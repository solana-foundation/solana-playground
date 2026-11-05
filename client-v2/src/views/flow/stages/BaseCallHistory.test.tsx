import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BaseCallHistory from "./BaseCallHistory";

// The history list: nothing before the first call, unless the wide layout
// keeps its column, which then says what will show there.
const props = {
  records: [],
  cluster: "devnet",
  txUrl: (s: string) => `https://x/tx/${s}`,
  onOpen: vi.fn(),
};

describe("BaseCallHistory", () => {
  it("renders nothing before the first call", () => {
    const { container } = render(<BaseCallHistory {...props} />);
    expect(container.firstChild).toBeNull();
  });

  it("keeps its heading and an empty line when asked to show the empty state", () => {
    render(<BaseCallHistory {...props} showEmpty />);
    const region = screen.getByRole("region", { name: "Call history" });
    expect(region.textContent).toContain("No calls yet");
    expect(region.textContent).toContain(
      "Calls you make here show with their result."
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists the calls and drops the empty line once there is one", () => {
    render(
      <BaseCallHistory
        records={[
          {
            id: "a",
            programId: "P",
            cluster: "devnet",
            instruction: "initialize",
            ok: true,
            signature: "sig1234567",
            // eslint-disable-next-line unicorn/no-null -- a stored record writes a missing failing line as null
            failingLine: null,
            at: 1,
          },
        ]}
        cluster="devnet"
        txUrl={(s: string) => `https://x/tx/${s}`}
        onOpen={vi.fn()}
        showEmpty
        className="sticky"
      />
    );
    const region = screen.getByRole("region", { name: "Call history" });
    expect(screen.getByRole("list")).toBeTruthy();
    expect(region.textContent).not.toContain("No calls yet");
    expect(region.className).toContain("sticky");
  });
});
