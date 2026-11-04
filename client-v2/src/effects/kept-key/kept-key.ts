import type { Disposable } from "../../utils/types";
import { dropKeptKey } from "../../views/sidebar/assistant/model/remembered-backend";

/**
 * Remove the key-based connection an older build kept in this tab's
 * `sessionStorage` (HOO-2423), once per page load.
 *
 * An effect, not the assistant's mount alone: a phone starts in Code with the
 * panel unmounted, and the key would stay stored until the user opened it.
 * The panel and the Settings row still drop it on mount, where it matters
 * before the effects run.
 */
export const keptKey = (): Disposable => {
  dropKeptKey();
  return { dispose: () => {} };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("effects/kept-key/kept-key", () => {
    it("removes a key an older build kept, with no panel mounted", () => {
      sessionStorage.setItem(
        "assistant.connection",
        JSON.stringify({ id: "openai", apiKey: "sk-test-kept-0123456789" })
      );

      keptKey();

      expect(sessionStorage.getItem("assistant.connection")).toBeNull();
    });
  });
}
