import { useSyncExternalStore } from "react";

import { readConsent, subscribeToConsent } from "@/shared/lib/telemetry";
import { Switch } from "@/shared/ui/switch";

import { chooseAndTellFor } from "./choose-consent";

const subscribe = (onChange: () => void) =>
  subscribeToConsent(() => onChange());

const chooseInSettings = chooseAndTellFor("settings");

interface BaseAnalyticsSwitchProps {
  /** The id the settings row's label points at */
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export const BaseAnalyticsSwitch = ({
  id,
  checked,
  onCheckedChange,
}: BaseAnalyticsSwitchProps) => (
  <Switch
    id={id}
    aria-label="Analytics"
    checked={checked}
    onCheckedChange={onCheckedChange}
  />
);

/**
 * `BaseAnalyticsSwitch` on the stored choice, for Settings, Advanced: on for
 * `allowed`, off for `unanswered` or `declined`.
 */
export const AnalyticsSwitch = ({ id }: { id?: string }) => {
  const choice = useSyncExternalStore(subscribe, readConsent);
  return (
    <BaseAnalyticsSwitch
      id={id}
      checked={choice === "allowed"}
      onCheckedChange={(on) => chooseInSettings(on ? "allowed" : "declined")}
    />
  );
};
