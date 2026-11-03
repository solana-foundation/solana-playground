import type { ModelProvider } from "@/shared/lib/ai";
import { isDefaultBackend } from "../../../views/sidebar/assistant/model/types";
import type { DefaultBackend } from "./default-backend";

/**
 * Why no model can answer this user, as the composer's off row says it:
 * - `no-key`: the deployment offers no hosted model, so a key of one's own is the way in
 * - `signed-out`: it offers one, and spends it only for a signed-in user
 * - `unreachable`: whether it offers one could not be read
 */
export type AiOffReason = "no-key" | "signed-out" | "unreachable";

/** What decides the off row: the connection, the deployment's answer and the session */
export interface AiOffInput {
  /** The connected backend's provider, or `null` with nothing connected */
  connected: ModelProvider | null;
  backend: DefaultBackend;
  /** Whether someone is signed in; `null` until the page's session read has answered */
  signedIn: boolean | null;
}

/**
 * Why the assistant is off for this user, or `null` while it can answer or
 * that is not known yet. A connected key-based backend is the user's own key
 * and always answers here; a connected default still needs a session.
 */
export const aiOff = ({
  connected,
  backend,
  signedIn,
}: AiOffInput): AiOffReason | null => {
  if (connected !== null && !isDefaultBackend(connected)) return null;
  switch (backend.state) {
    case "checking":
      return null;
    case "absent":
      return "no-key";
    case "unreachable":
      return "unreachable";
    case "present":
      if (signedIn === null) return null;
      return signedIn ? null : "signed-out";
    default: {
      const unknown: never = backend;
      return unknown;
    }
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/assistant/model/ai-off", () => {
    const present: DefaultBackend = { state: "present", model: "m" };

    it("is off for no key, signed out or unreachable", () => {
      expect(
        aiOff({ connected: null, backend: { state: "absent" }, signedIn: true })
      ).toBe("no-key");
      expect(
        aiOff({ connected: null, backend: present, signedIn: false })
      ).toBe("signed-out");
      expect(
        aiOff({
          connected: null,
          backend: { state: "unreachable" },
          signedIn: true,
        })
      ).toBe("unreachable");
    });

    it("is on for a signed-in user with a hosted model", () => {
      expect(
        aiOff({ connected: null, backend: present, signedIn: true })
      ).toBeNull();
    });

    it("says nothing while the deployment or the session is still being read", () => {
      expect(
        aiOff({
          connected: null,
          backend: { state: "checking" },
          signedIn: false,
        })
      ).toBeNull();
      expect(
        aiOff({ connected: null, backend: present, signedIn: null })
      ).toBeNull();
    });

    it("is on with a key of one's own, whatever the deployment says", () => {
      expect(
        aiOff({
          connected: "anthropic",
          backend: { state: "absent" },
          signedIn: false,
        })
      ).toBeNull();
    });

    it("is off for a connected default once its user signs out", () => {
      expect(
        aiOff({ connected: "default", backend: present, signedIn: false })
      ).toBe("signed-out");
    });
  });
}
