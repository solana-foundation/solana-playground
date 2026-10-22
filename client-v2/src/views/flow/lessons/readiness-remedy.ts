import type { Blocker } from "./readiness";
import { DEFAULT_ENDPOINT } from "../../../constants";
import { isSetupRejected } from "@/commands/connect/setup-rejected";
import { isSignInFailure, PgSession } from "../../../features/auth";
import {
  markFailureShown,
  reportButtonFailure,
} from "@/shared/lib/report-button-failure";
import { PgCommand, PgSettings } from "../../../utils";

/**
 * The one action that clears a blocker.
 *
 * Each is the same thing the account menu or the stage button already
 * does, so the explainer never has a path of its own to drift on. Kept
 * out of the band so it can be tested without a rendered tree -- this
 * is the layer where a wrong endpoint or a swallowed rejection hides.
 *
 * @returns what to run when the learner clicks the blocker's remedy
 */
export const remedy = (b: Blocker): (() => void) => {
  switch (b.kind) {
    case "needs-build":
    case "needs-rebuild":
      return () => {
        PgCommand.build.execute().catch(reportButtonFailure("build"));
      };

    case "needs-wallet":
      // Closing the wallet setup is the user's choice: logged under
      // `ui:button` like every failed click, but not toasted
      return () => {
        PgCommand.connect.execute().catch((error: unknown) => {
          if (isSetupRejected(error)) markFailureShown(error);
          reportButtonFailure("connect a wallet")(error);
        });
      };

    case "needs-cluster":
      // `DEFAULT_ENDPOINT`, not `Endpoint.DEVNET`: a deployment that
      // configures a platform devnet should not have its learners
      // bounced onto the rate-limited public RPC mid-lesson
      return () => {
        PgSettings.connection.endpoint = DEFAULT_ENDPOINT;
      };

    case "needs-sol":
      return b.signedIn
        ? () => {
            PgCommand.airdrop.execute().catch(reportButtonFailure("airdrop"));
          }
        : () => {
            PgSession.signIn().catch((error: unknown) => {
              // A cancelled, blocked or refused sign-in is held in
              // `PgSession.signInState`, and the account row shows it
              if (isSignInFailure(error)) markFailureShown(error);
              reportButtonFailure("sign in")(error);
            });
          };
  }
};
