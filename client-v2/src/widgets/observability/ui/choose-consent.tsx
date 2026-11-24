import type { ConsentChoice } from "@/shared/lib/telemetry";
import { PgView } from "@/utils/view";

import { chooseConsentFor } from "../model/consent";
import type { ConsentVia } from "../model/telemetry";

/**
 * Said when storage refused the choice: a decline still holds for the page,
 * an Allow never does (`writeConsent`)
 */
const CONSENT_UNSAVED_TEXT: Record<ConsentChoice, string> = {
  declined: "Couldn't save your choice; it applies until you reload.",
  allowed: "Couldn't save your choice, so analytics stays off.",
};

/**
 * `chooseConsentFor`, telling the visitor in a toast when the choice could not
 * be stored.
 */
export const chooseAndTellFor = (via: ConsentVia) => {
  const choose = chooseConsentFor(via);
  return (choice: ConsentChoice): void => {
    if (choose(choice)) return;
    PgView.setToast(() => <span>{CONSENT_UNSAVED_TEXT[choice]}</span>, {
      options: { name: "analytics-consent-unsaved" },
    });
  };
};
