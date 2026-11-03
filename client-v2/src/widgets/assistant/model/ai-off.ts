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
  /** The connected backend's provider; absent with nothing connected */
  connected?: ModelProvider;
  backend: DefaultBackend;
  /** Whether someone is signed in; `undefined` until the page's session read has answered */
  signedIn: boolean | undefined;
}

/**
 * Why the assistant is off for this user, or `undefined` while it can answer or
 * that is not known yet. A connected key-based backend is the user's own key
 * and always answers here; a connected default still needs a session.
 */
export const aiOff = ({
  connected,
  backend,
  signedIn,
}: AiOffInput): AiOffReason | undefined => {
  if (connected !== undefined && !isDefaultBackend(connected)) return;
  switch (backend.state) {
    case "checking":
      return;
    case "absent":
      return "no-key";
    case "unreachable":
      return "unreachable";
    case "present":
      if (signedIn === undefined) return;
      return signedIn ? undefined : "signed-out";
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
      expect(aiOff({ backend: { state: "absent" }, signedIn: true })).toBe(
        "no-key"
      );
      expect(aiOff({ backend: present, signedIn: false })).toBe("signed-out");
      expect(
        aiOff({
          backend: { state: "unreachable" },
          signedIn: true,
        })
      ).toBe("unreachable");
    });

    it("is on for a signed-in user with a hosted model", () => {
      expect(aiOff({ backend: present, signedIn: true })).toBeUndefined();
    });

    it("says nothing while the deployment or the session is still being read", () => {
      expect(
        aiOff({
          backend: { state: "checking" },
          signedIn: false,
        })
      ).toBeUndefined();
      expect(aiOff({ backend: present, signedIn: undefined })).toBeUndefined();
    });

    it("is on with a key of one's own, whatever the deployment says", () => {
      expect(
        aiOff({
          connected: "anthropic",
          backend: { state: "absent" },
          signedIn: false,
        })
      ).toBeUndefined();
    });

    it("is off for a connected default once its user signs out", () => {
      expect(
        aiOff({ connected: "default", backend: present, signedIn: false })
      ).toBe("signed-out");
    });
  });
}
