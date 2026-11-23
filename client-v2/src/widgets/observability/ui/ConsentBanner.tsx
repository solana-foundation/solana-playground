import { useSyncExternalStore } from "react";

import { readConsent, subscribeToConsent } from "@/shared/lib/telemetry";

import { chooseConsentFor } from "../model/consent";
import { BaseConsentBanner } from "./BaseConsentBanner";

const subscribe = (onChange: () => void) =>
  subscribeToConsent(() => onChange());

const chooseOnBanner = chooseConsentFor("banner");

/**
 * `BaseConsentBanner` on the stored choice: shows while it is `unanswered`,
 * and either button stores the answer, which closes it.
 */
export const ConsentBanner = () => {
  const choice = useSyncExternalStore(subscribe, readConsent);
  // eslint-disable-next-line unicorn/no-null -- a component's return type admits `null`, not `undefined`
  if (choice !== "unanswered") return null;
  return (
    <BaseConsentBanner
      onDecline={() => chooseOnBanner("declined")}
      onAllow={() => chooseOnBanner("allowed")}
    />
  );
};
