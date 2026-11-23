import { render, screen } from "@testing-library/react";

import { BaseChatLimitRow } from "./BaseChatLimitRow";

describe("BaseChatLimitRow", () => {
  it("names the message cap with its figure, and what happens to new messages", () => {
    render(
      <BaseChatLimitRow
        limit={{ reason: "too-many-messages", limit: 20_000, count: 20_001 }}
      />
    );

    const text = screen.getByRole("status").textContent;
    expect(text).toContain("Conversations are not syncing");
    expect(text).toContain("Your account syncs at most 20,000 messages.");
    expect(text).toContain("New messages stay in this browser.");
    expect(text).toContain("Delete a synced project");
  });

  it("names the conversation cap", () => {
    render(
      <BaseChatLimitRow
        limit={{ reason: "too-many-threads", limit: 200, count: 201 }}
      />
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Your account syncs at most 200 conversations."
    );
  });

  it("names the size cap in megabytes", () => {
    render(
      <BaseChatLimitRow
        limit={{
          reason: "conversations-too-large",
          limit: 32 * 1024 * 1024,
          count: 32 * 1024 * 1024 + 1,
        }}
      />
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Your account syncs at most 32 MB of conversations."
    );
  });
});
