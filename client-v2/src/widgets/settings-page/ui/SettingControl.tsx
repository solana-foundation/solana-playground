import { FC, useMemo } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Checkbox } from "@/shared/ui/checkbox";
import { useRenderOnChange } from "@/hooks";
import { PgCommon, PgView, RequiredKey, Setting as SettingType } from "@/utils";
import { CustomSetting } from "@/views/flow/settings/CustomSetting";

type SettingSetterProps = SettingType;

/** The control that sets one setting: a select when it has values, else a checkbox */
export const SettingControl: FC<
  React.PropsWithChildren<SettingSetterProps>
> = ({ values, ...props }) => {
  useRenderOnChange(props.onChange);
  if (values) return <SettingSetterSelect values={values} {...props} />;
  return <SettingSetterCheckBox {...props} />;
};

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
    const entries: Entry[] = PgCommon.callIfNeeded(setting.values).map(
      convertValue
    );
    if (setting.custom) entries.push({ label: "Custom", value: CUSTOM_VALUE });

    return entries;
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
        aria-label={setting.name}
        className="w-full max-md:text-body max-md:font-read max-md:data-[size=default]:h-12"
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

type SettingSetterCheckBoxProps = Omit<SettingSetterProps, "values">;

const SettingSetterCheckBox: FC<
  React.PropsWithChildren<SettingSetterCheckBoxProps>
> = ({ name, getValue, setValue }) => (
  <Checkbox
    aria-label={name}
    checked={getValue()}
    onCheckedChange={(checked) => setValue(checked === true)}
  />
);
