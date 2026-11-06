import { FC, useMemo } from "react";

import { useRenderOnChange } from "@/hooks";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import { PgCommon, PgView, RequiredKey, Setting as SettingType } from "@/utils";
import { CustomSetting } from "@/views/flow/settings/CustomSetting";

type SettingSetterProps = SettingType & {
  /** The control's id, which the row's label points at */
  controlId?: string;
  /** A few named choices side by side instead of a select */
  segmented?: boolean;
};

/**
 * The control that sets one setting: a select when it has values (or a
 * segmented control when asked), else a switch
 */
export const SettingControl: FC<
  React.PropsWithChildren<SettingSetterProps>
> = ({ values, segmented, ...props }) => {
  useRenderOnChange(props.onChange);
  if (values && segmented) {
    return <SettingSetterSegmented values={values} {...props} />;
  }
  if (values) return <SettingSetterSelect values={values} {...props} />;
  return <SettingSetterSwitch {...props} />;
};

type SettingSetterSegmentedProps = RequiredKey<
  Omit<SettingSetterProps, "segmented">,
  "values"
>;

/** A setting with a few plain values, all in sight */
const SettingSetterSegmented: FC<SettingSetterSegmentedProps> = ({
  values,
  name,
  getValue,
  setValue,
}) => (
  <Segmented
    aria-label={name}
    value={getValue()}
    onValueChange={(v) => {
      // A press on the current choice clears a toggle group; a setting keeps it
      if (v) setValue(v);
    }}
  >
    {PgCommon.callIfNeeded(values)
      .map(convertValue)
      .map((o) =>
        isGroup(o) ? null : (
          <SegmentedItem
            key={o.value}
            value={o.value}
            className="max-md:h-11 max-md:px-4"
          >
            {o.label}
          </SegmentedItem>
        )
      )}
  </Segmented>
);

type SettingSetterSelectProps = RequiredKey<SettingSetterProps, "values">;

type Option = { label: string; value: string };
type Group = { label: string; options: Option[] };
type Entry = Option | Group;

const isGroup = (e: Entry): e is Group => "options" in e;

/**
 * Stands for the "Custom" row. An empty string cannot, because Radix refuses
 * an item with an empty value and no setting may have one as its default.
 */
const CUSTOM_VALUE = "__custom__";

export const SettingSetterSelect: FC<
  React.PropsWithChildren<SettingSetterSelectProps>
> = (setting) => {
  const entries = useMemo(() => {
    const options: Entry[] = PgCommon.callIfNeeded(setting.values).map(
      convertValue
    );
    if (setting.custom) options.push({ label: "Custom", value: CUSTOM_VALUE });

    return options;
  }, [setting.values, setting.custom]);

  const value =
    findOption(entries, setting.getValue())?.value ??
    (setting.custom ? CUSTOM_VALUE : undefined);

  const openCustom = () => {
    if (setting.custom?.Component) PgView.setModal(setting.custom.Component);
    else PgView.setModal(<CustomSetting setting={setting} />);
  };

  const renderOption = (o: Option) => {
    // Picking the row that is already selected fires no `onValueChange`, yet
    // `CustomSetting` is how the user edits the custom value they have, and
    // the old select reopened it. So the current Custom row opens the modal
    // itself, on pointer and on Enter/Space. Any other pick goes through
    // `onValueChange`, so the two paths never both run.
    const reopens = o.value === CUSTOM_VALUE && value === CUSTOM_VALUE;
    return (
      <SelectItem
        key={o.value}
        value={o.value}
        onPointerUp={reopens ? openCustom : undefined}
        onKeyDown={
          reopens
            ? (ev) => {
                if (ev.key === "Enter" || ev.key === " ") openCustom();
              }
            : undefined
        }
      >
        {o.label}
      </SelectItem>
    );
  };

  return (
    <Select
      // A stored value no option has, and no Custom row to stand for it:
      // `""` keeps the select controlled and shows the empty trigger, where
      // `undefined` would hand the value to Radix's own state
      value={value ?? ""}
      onValueChange={(v) => {
        if (v === CUSTOM_VALUE) openCustom();
        else setting.setValue(v);
      }}
    >
      <SelectTrigger
        id={setting.controlId}
        aria-label={setting.name}
        className="w-full max-md:text-body font-read max-md:data-[size=default]:h-12"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {entries.map((e) =>
          isGroup(e) ? (
            <SelectGroup key={e.label}>
              <SelectLabel>{e.label}</SelectLabel>
              {e.options.map(renderOption)}
            </SelectGroup>
          ) : (
            renderOption(e)
          )
        )}
      </SelectContent>
    </Select>
  );
};

/**
 * Convert the setting value to make it compatible with the `Select` component.
 *
 * @param v the value to convert
 * @returns the converted value
 */
const convertValue = (v: any): Entry => {
  if (typeof v === "object") {
    if (v.value) return { label: v.name, value: v.value };
    if (v.values) return { label: v.name, options: v.values.map(convertValue) };
    throw new Error(`Invalid option value: ${v}`);
  }

  return { label: PgCommon.toTitleFromKebab(v), value: v };
};

/**
 * Recursively try to find the option based on the value set.
 *
 * @param entries options and groups
 * @param v value
 * @returns the option if found
 */
const findOption = (entries: Entry[], v: unknown): Option | undefined => {
  for (const entry of entries) {
    if (isGroup(entry)) {
      const res = findOption(entry.options, v);
      if (res) return res;
    } else if (entry.value === v) {
      return entry;
    }
  }
};

type SettingSetterSwitchProps = Omit<SettingSetterProps, "values">;

const SettingSetterSwitch: FC<
  React.PropsWithChildren<SettingSetterSwitchProps>
> = ({ name, controlId, getValue, setValue }) => (
  <Switch
    id={controlId}
    aria-label={name}
    checked={getValue()}
    onCheckedChange={setValue}
  />
);
